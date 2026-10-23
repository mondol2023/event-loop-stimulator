import { LIMITS } from "@/core/shared/limits";
import type { Instruction } from "@/core/bytecode/BytecodeArray";
import type { BytecodeFunction, BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import type { Opcode } from "@/core/bytecode/bytecodes";
import { FeedbackCell } from "@/core/runtime/objects/FeedbackCell";
import type { JSGeneratorObject, ResumeMode } from "@/core/runtime/objects/JSGeneratorObject";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import { JSObject } from "@/core/runtime/objects/JSObject";
import type { JSMessageObject } from "@/core/runtime/objects/JSMessageObject";
import type { CallTarget, Realm } from "@/core/runtime/Realm";
import { OrdinaryGet, OrdinarySet } from "@/core/runtime/spec/objectOps";
import type { CallSite } from "@/core/runtime/stack";
import type { JSValue } from "@/core/runtime/values/JSValue";
import type { FunctionId } from "@/core/shared/ids";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import type { Command } from "@/core/timeline/Command";
import { callSiteOf, nativeCallSite } from "./callSites";
import { type Completion, isThrow, normal } from "./Completion";
import { arithHandler } from "./dispatch/arith";
import { callHandler, constructHandler, runtimeHandler } from "./dispatch/calls";
import { compareHandler } from "./dispatch/compare";
import type { DispatchContext } from "./dispatch/context";
import { accumulatorValue } from "./dispatch/context";
import { contextHandler } from "./dispatch/contexts";
import { enterHandler, exceptionHandler, messageAt } from "./dispatch/exceptions";
import { generatorHandler } from "./dispatch/generators";
import { jumpHandler } from "./dispatch/jumps";
import { loadHandler } from "./dispatch/loads";
import { propertyHandler } from "./dispatch/properties";
import { Frame, writeRegister } from "./Frame";
import { sourceRangeForPos } from "@/core/views/types";
import { NO_TIERING, type TieringHooks } from "./tiering/TieringModel";

// Ignition, V8's bytecode interpreter, over the BytecodeArrays the generator produced: the
// same ones the bytecode pane prints. The register file is the Frame; every dispatch is
// reported to the observer before it executes.

/** User JS frames that may be active at once, the wrapper included (PROMPT §7.1). */
export const CALL_DEPTH_LIMIT = LIMITS.callDepth;

export interface StepObserver {
  onCommand(c: Command): void;
}

export const NO_OBSERVER: StepObserver = { onCommand: () => undefined };

/** Opcodes the bytecode generator never emits for the supported subset (see excluded.ts), plus the prefixes and debug forms. */
export const UNREACHABLE_OPCODES = [
  "Wide",
  "ExtraWide",
  "DebugBreakWide",
  "DebugBreakExtraWide",
  "DebugBreak0",
  "DebugBreak1",
  "DebugBreak2",
  "DebugBreak3",
  "DebugBreak4",
  "DebugBreak5",
  "DebugBreak6",
  "LdaScriptContextSlot",
  "LdaCurrentScriptContextSlot",
  "StaScriptContextSlot",
  "StaCurrentScriptContextSlot",
  "LdaLookupSlot",
  "LdaLookupContextSlot",
  "LdaLookupScriptContextSlot",
  "LdaLookupGlobalSlot",
  "LdaLookupSlotInsideTypeof",
  "LdaLookupContextSlotInsideTypeof",
  "LdaLookupScriptContextSlotInsideTypeof",
  "LdaLookupGlobalSlotInsideTypeof",
  "StaLookupSlot",
  "GetNamedPropertyFromSuper",
  "GetEnumeratedKeyedProperty",
  "LdaModuleVariable",
  "StaModuleVariable",
  "DefineKeyedOwnProperty",
  "DefineKeyedOwnPropertyInLiteral",
  "GetSuperConstructor",
  "FindNonDefaultConstructorOrConstruct",
  "CallAnyReceiver",
  "CallWithSpread",
  "CallRuntimeForPair",
  "CallJSRuntime",
  "ConstructWithSpread",
  "ConstructForwardAllArgs",
  "TestInstanceOf",
  // `in` is refused by the validator until the operator is supported (its TypeError text has no fixture).
  "TestIn",
  "ToName",
  "ToObject",
  "CreateRegExpLiteral",
  "CreateArrayFromIterable",
  "CloneObject",
  "GetTemplateObject",
  "CreateEvalContext",
  "CreateWithContext",
  "CreateRestParameter",
  "JumpIfForInDoneConstant",
  "JumpIfForInDone",
  "ForInEnumerate",
  "ForInPrepare",
  "ForInNext",
  "ForInStep",
  "ThrowSuperNotCalledIfHole",
  "ThrowSuperAlreadyCalledIfNotHole",
  "ThrowIfNotSuperConstructor",
  "GetIterator",
  "Debugger",
  "IncBlockCounter",
  "Abort",
  "Illegal",
] as const satisfies readonly Opcode[];

type NeverEmittedOpcode = (typeof UNREACHABLE_OPCODES)[number];

function isUnreachable(opcode: Opcode): opcode is NeverEmittedOpcode {
  return (UNREACHABLE_OPCODES as readonly Opcode[]).includes(opcode);
}

/** A programmer error: the generator emitted an opcode that is declared unreachable for the subset. */
export class UnreachableOpcode extends Error {
  constructor(opcode: Opcode) {
    super(`opcode ${opcode} is never emitted for the supported subset`);
    this.name = "UnreachableOpcode";
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled opcode ${String(value)}`);
}

export class IgnitionInterpreter implements CallTarget, DispatchContext {
  readonly realm: Realm;
  readonly #program: BytecodeProgram;
  readonly #observer: StepObserver;
  /** Write-only: the model never feeds anything back into a run. */
  readonly tiering: TieringHooks;
  /** Active frames, outermost first. */
  readonly #frames: Frame[] = [];
  /** Builtins on the stack; `below` is how many JS frames were under the builtin when it was called. */
  readonly #natives: { readonly below: number; readonly fn: JSFunction; readonly receiver: JSValue; readonly construct: boolean }[] = [];
  /**
   * The isolate's pending message (Isolate::pending_message): where the exception in flight was
   * thrown. It outlives an uncaught exception, so the host can print its code frame.
   */
  pendingMessage: JSMessageObject | undefined = undefined;

  constructor(program: BytecodeProgram, realm: Realm, observer: StepObserver, tiering: TieringHooks = NO_TIERING) {
    this.#program = program;
    this.realm = realm;
    this.#observer = observer;
    this.tiering = tiering;
    realm.attach(this);
  }

  /** The active user frames, outermost first. Read-only: the timeline's view of the stack. */
  get activeFrames(): readonly Frame[] {
    return this.#frames;
  }

  /** The program this interpreter runs (the host prints code frames from its source). */
  get program(): BytecodeProgram {
    return this.#program;
  }

  /**
   * Runs the CommonJS wrapper (function 0) with `(exports, require, module, __filename, __dirname)`
   * and `this === module.exports`, as Node's loader calls it.
   */
  runScript(): Completion {
    const code = this.#program.functions[0];
    if (!code) throw new Error("the program has no wrapper function");
    const realm = this.realm;
    const feedbackCell = new FeedbackCell();
    feedbackCell.allocateVector(code);
    const wrapper = realm.heap.allocate(
      (id) =>
        new JSFunction(id, realm.maps.rootFor("function", 0), realm.intrinsics.functionPrototype, {
          code,
          context: realm.emptyContext,
          feedbackCell,
        }),
    );
    const exports = realm.newObject();
    const moduleObject = realm.newObject();
    OrdinarySet(realm, moduleObject, "exports", exports);
    const require = realm.nativeFunction("require", 1, () => normal(undefined));
    return this.call(wrapper, realm.scriptThisIsGlobal ? realm.globalObject : exports, [exports, require, moduleObject, "main.cjs", ""]);
  }

  /** Calls `fn`. Re-entrant: a builtin that takes a callback calls back through here. */
  call(fn: JSFunction, receiver: JSValue, args: readonly JSValue[]): Completion {
    const native = fn.native;
    if (native) {
      if (fn.hiddenFromStackTrace) return native(this.realm, receiver, args);
      return this.nativeFrame(fn, receiver, false, () => native(this.realm, receiver, args));
    }
    if (!fn.code) throw new Error("a function with neither bytecode nor a native behavior");
    return this.#enter(new Frame(fn, fn.code, fn.code.strict ? receiver : this.#sloppyThis(receiver), args), true);
  }

  /** [[Construct]] of an ordinary function: OrdinaryCreateFromConstructor, then the body with the new object as `this`. */
  construct(fn: JSFunction, args: readonly JSValue[]): Completion {
    const code = fn.code;
    if (!code?.constructable) throw new Error("construct on a function that is not a constructor");
    const prototype = OrdinaryGet(fn, "prototype");
    const receiver = this.realm.newConstructedObject(fn, prototype instanceof JSObject ? prototype : this.realm.intrinsics.objectPrototype);
    const frame = new Frame(fn, code, receiver, args);
    frame.isConstruct = true;
    const result = this.#enter(frame, true);
    if (isThrow(result)) return result;
    return normal(result.value instanceof JSObject ? result.value : receiver);
  }

  isActive(fn: JSFunction): boolean {
    return this.#frames.some((f) => f.fn === fn);
  }

  functionSource(fn: JSFunction): string | undefined {
    const range = fn.code?.sourceRange;
    return range && this.#program.source.slice(range.start, range.end);
  }

  /**
   * ResumeGeneratorTrampoline: a new frame for the suspended function, with its saved parameters
   * and the generator in the register its SwitchOnGeneratorState reads, so execution jumps to the
   * suspend point. The registers come back with ResumeGenerator.
   */
  resumeGenerator(generator: JSGeneratorObject, value: JSValue, mode: ResumeMode): Completion {
    const fn = generator.function;
    const code = fn.code;
    if (!code) throw new Error("a generator over a function with no bytecode");
    const entry = code.array.instructionAt(0);
    if (entry?.opcode !== "SwitchOnGeneratorState") throw new Error(`function ${code.id} has no generator prologue`);
    const register = entry.operands[0];
    if (typeof register !== "number") throw new Error("SwitchOnGeneratorState without a register operand");
    generator.inputOrDebugPos = value;
    generator.resumeMode = mode;
    const frame = new Frame(fn, code, generator.receiver, generator.parameters);
    writeRegister(frame, register, generator);
    return this.#enter(frame, false);
  }

  /** `invoked` is false for a generator resume, which bypasses the entry trampoline V8 counts invocations in. */
  #enter(frame: Frame, invoked: boolean): Completion {
    // The depth limit is the simulator's, never a RangeError (PROMPT §7.1).
    if (this.#frames.length >= CALL_DEPTH_LIMIT) throw new SimulationHalt({ kind: "limit", limit: "callDepth" });
    if (invoked) this.tiering.onInvoke({ functionId: frame.code.id, bytecodeLength: frame.code.array.length });
    this.#frames.push(frame);
    try {
      return this.#run(frame);
    } finally {
      this.#frames.pop();
    }
  }

  nativeFrame<T>(fn: JSFunction, receiver: JSValue, construct: boolean, body: () => T): T {
    this.#natives.push({ below: this.#frames.length, fn, receiver, construct });
    try {
      return body();
    } finally {
      this.#natives.pop();
    }
  }

  clearPendingMessage(): void {
    this.pendingMessage = undefined;
  }

  calleeText(frame: Frame): string | undefined {
    const range = sourceRangeForPos(this.#program, { functionId: frame.code.id, bytecodeOffset: frame.offset });
    return range === undefined ? undefined : this.#program.callPrinter[range.start];
  }

  functionCode(id: FunctionId): BytecodeFunction {
    const code = this.#program.functions[id];
    if (!code) throw new Error(`no function ${id} in the program`);
    return code;
  }

  /** OrdinaryCallBindThis for a sloppy function: undefined and null become the global object, a primitive its wrapper object. */
  #sloppyThis(receiver: JSValue): JSValue {
    if (receiver === undefined || receiver === null) return this.realm.globalObject;
    const object = this.realm.toObject(receiver);
    if (isThrow(object)) throw new Error("ToObject of a non-nullish receiver cannot throw");
    return object.value;
  }

  callSites(): readonly CallSite[] {
    const sites: CallSite[] = [];
    let n = this.#natives.length - 1;
    for (let i = this.#frames.length; i >= 0; i--) {
      // A builtin called with `i` JS frames beneath it sits above frame `i - 1`.
      for (let native = this.#natives[n]; native && native.below === i; native = this.#natives[--n]) {
        sites.push(nativeCallSite(native.fn, native.receiver, native.construct));
      }
      const frame = this.#frames[i - 1];
      if (frame) sites.push(callSiteOf(this.realm, this.#program, frame));
    }
    return sites;
  }

  #run(frame: Frame): Completion {
    const array = frame.code.array;
    for (;;) {
      const instr = array.instructionAt(frame.offset);
      if (!instr) throw new Error(`no instruction at offset ${frame.offset} of function ${frame.code.id}`);
      this.#observer.onCommand({
        kind: "dispatch",
        pos: { functionId: frame.code.id, bytecodeOffset: instr.offset },
        opcode: instr.opcode,
      });
      frame.next = instr.offset + instr.size;
      const done = this.#execute(frame, instr);
      if (done?.type === "throw") {
        // An exception raised by this instruction (or by a builtin it called) has no message yet;
        // one that unwound out of a callee keeps the callee's, and so does a ReThrow.
        this.pendingMessage ??= messageAt(frame);
        if (!enterHandler(frame, done.value)) return done;
      } else if (done) {
        return done;
      }
      frame.offset = frame.next;
    }
  }

  /** Executes one instruction; returns a Completion only when it ends the frame. */
  #execute(frame: Frame, instr: Instruction): Completion | undefined {
    switch (instr.opcode) {
      case "LdaZero":
      case "LdaSmi":
      case "LdaUndefined":
      case "LdaNull":
      case "LdaTheHole":
      case "LdaTrue":
      case "LdaFalse":
      case "LdaConstant":
      case "Ldar":
      case "Star":
      case "Mov":
      case "Star0":
      case "Star1":
      case "Star2":
      case "Star3":
      case "Star4":
      case "Star5":
      case "Star6":
      case "Star7":
      case "Star8":
      case "Star9":
      case "Star10":
      case "Star11":
      case "Star12":
      case "Star13":
      case "Star14":
      case "Star15":
      case "LdaGlobal":
      case "LdaGlobalInsideTypeof":
      case "StaGlobal":
        return loadHandler(this, frame, instr);

      case "Add":
      case "Sub":
      case "Mul":
      case "Div":
      case "Mod":
      case "Exp":
      case "BitwiseOr":
      case "BitwiseXor":
      case "BitwiseAnd":
      case "ShiftLeft":
      case "ShiftRight":
      case "ShiftRightLogical":
      case "AddSmi":
      case "SubSmi":
      case "MulSmi":
      case "DivSmi":
      case "ModSmi":
      case "ExpSmi":
      case "BitwiseOrSmi":
      case "BitwiseXorSmi":
      case "BitwiseAndSmi":
      case "ShiftLeftSmi":
      case "ShiftRightSmi":
      case "ShiftRightLogicalSmi":
      case "Inc":
      case "Dec":
      case "Negate":
      case "BitwiseNot":
      case "ToBooleanLogicalNot":
      case "LogicalNot":
      case "TypeOf":
      case "ToNumber":
      case "ToNumeric":
      case "ToString":
      case "ToBoolean":
        return arithHandler(this, frame, instr);

      case "TestEqual":
      case "TestEqualStrict":
      case "TestLessThan":
      case "TestGreaterThan":
      case "TestLessThanOrEqual":
      case "TestGreaterThanOrEqual":
      case "TestReferenceEqual":
      case "TestUndetectable":
      case "TestNull":
      case "TestUndefined":
      case "TestTypeOf":
        return compareHandler(this, frame, instr);

      case "Jump":
      case "JumpConstant":
      case "JumpLoop":
      case "JumpIfNullConstant":
      case "JumpIfNotNullConstant":
      case "JumpIfUndefinedConstant":
      case "JumpIfNotUndefinedConstant":
      case "JumpIfUndefinedOrNullConstant":
      case "JumpIfTrueConstant":
      case "JumpIfFalseConstant":
      case "JumpIfJSReceiverConstant":
      case "JumpIfToBooleanTrueConstant":
      case "JumpIfToBooleanFalseConstant":
      case "JumpIfToBooleanTrue":
      case "JumpIfToBooleanFalse":
      case "JumpIfTrue":
      case "JumpIfFalse":
      case "JumpIfNull":
      case "JumpIfNotNull":
      case "JumpIfUndefined":
      case "JumpIfNotUndefined":
      case "JumpIfUndefinedOrNull":
      case "JumpIfJSReceiver":
        return jumpHandler(this, frame, instr);

      case "GetNamedProperty":
      case "GetKeyedProperty":
      case "SetNamedProperty":
      case "SetKeyedProperty":
      case "DefineNamedOwnProperty":
      case "CreateObjectLiteral":
      case "CreateEmptyObjectLiteral":
      case "CreateArrayLiteral":
      case "CreateEmptyArrayLiteral":
      case "StaInArrayLiteral":
      case "DeletePropertyStrict":
      case "DeletePropertySloppy":
        return propertyHandler(this, frame, instr);

      case "CallProperty":
      case "CallProperty0":
      case "CallProperty1":
      case "CallProperty2":
      case "CallUndefinedReceiver":
      case "CallUndefinedReceiver0":
      case "CallUndefinedReceiver1":
      case "CallUndefinedReceiver2":
        return callHandler(this, frame, instr);

      case "Return":
        return normal(accumulatorValue(frame));

      case "CreateMappedArguments":
      case "CreateUnmappedArguments":
        frame.accumulator = this.realm.newArguments(frame.fn, frame.actualArgs, instr.opcode === "CreateUnmappedArguments");
        return undefined;

      case "CreateClosure":
      case "CreateBlockContext":
      case "CreateCatchContext":
      case "CreateFunctionContext":
      case "PushContext":
      case "PopContext":
      case "LdaContextSlot":
      case "LdaImmutableContextSlot":
      case "LdaCurrentContextSlot":
      case "LdaImmutableCurrentContextSlot":
      case "StaContextSlot":
      case "StaCurrentContextSlot":
      case "ThrowReferenceErrorIfHole":
        return contextHandler(this, frame, instr);

      case "Construct":
        return constructHandler(this, frame, instr);

      case "CallRuntime":
        return runtimeHandler(this, frame, instr);

      case "Throw":
      case "ReThrow":
      case "SetPendingMessage":
      case "SwitchOnSmiNoFeedback":
        return exceptionHandler(this, frame, instr);

      case "SwitchOnGeneratorState":
      case "SuspendGenerator":
      case "ResumeGenerator":
      case "InvokeIntrinsic":
        return generatorHandler(this, frame, instr);

      default: {
        const opcode: Opcode = instr.opcode;
        if (isUnreachable(opcode)) throw new UnreachableOpcode(opcode);
        return assertNever(opcode);
      }
    }
  }
}

