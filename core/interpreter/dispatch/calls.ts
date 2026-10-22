import type { Instruction } from "@/core/bytecode/BytecodeArray";
import { RUNTIME_NATIVE_FUNCTIONS } from "@/core/runtime/builtins/natives";
import { formatMessage } from "@/core/runtime/messages";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { type Completion, isThrow } from "../Completion";
import { type Frame, listRegister, readRegister } from "../Frame";
import { type DispatchContext, type Handler, operand } from "./context";

// Call opcodes (src/interpreter/bytecodes.h). The callee is always a register; the receiver is
// `undefined` for CallUndefinedReceiver* and the first register of the argument list for
// CallProperty*. The sloppy `this` coercion and the call-depth limit are in IgnitionInterpreter.call.

type CallShape = { readonly receiver: "undefined" | "first"; readonly count: number | "list" };

const SHAPES: Readonly<Record<string, CallShape>> = {
  CallProperty: { receiver: "first", count: "list" },
  CallProperty0: { receiver: "first", count: 1 },
  CallProperty1: { receiver: "first", count: 2 },
  CallProperty2: { receiver: "first", count: 3 },
  CallUndefinedReceiver: { receiver: "undefined", count: "list" },
  CallUndefinedReceiver0: { receiver: "undefined", count: 0 },
  CallUndefinedReceiver1: { receiver: "undefined", count: 1 },
  CallUndefinedReceiver2: { receiver: "undefined", count: 2 },
};

/** The registers a call names after its callee: a RegList and RegCount, or up to three single registers. */
function argumentRegisters(instr: Instruction, shape: CallShape): number[] {
  if (shape.count === "list") {
    const first = operand(instr, 1);
    return Array.from({ length: operand(instr, 2) }, (_, i) => listRegister(first, i));
  }
  return Array.from({ length: shape.count }, (_, i) => operand(instr, 1 + i));
}

export const callHandler: Handler = (ctx, frame, instr) => {
  const shape = SHAPES[instr.opcode];
  if (!shape) throw new Error(`${instr.opcode} is not a call opcode`);
  const callee = readRegister(frame, operand(instr, 0));
  const registers = argumentRegisters(instr, shape);
  const values = registers.map((r) => readRegister(frame, r) as JSValue);
  const receiver = shape.receiver === "first" ? values[0] : undefined;
  const args = shape.receiver === "first" ? values.slice(1) : values;
  if (!(callee instanceof JSFunction)) {
    // Runtime_ThrowCalledNonCallable: the message names the callee as CallPrinter prints it.
    const text = ctx.calleeText(frame);
    if (text === undefined) throw new SimulationHalt({ kind: "unsupported", reason: "calling a value that is not a function, through a callee CallPrinter prints as an intermediate value" });
    return ctx.realm.throwTypeError(formatMessage("kCalledNonCallable", text));
  }
  const result = ctx.call(callee, receiver, args);
  if (isThrow(result)) return result;
  frame.accumulator = result.value;
  return undefined;
};

/** The values of the RegList whose first register and count are operands `index` and `index + 1`. */
function listValues(frame: Frame, instr: Instruction, index: number): JSValue[] {
  const first = operand(instr, index);
  return Array.from({ length: operand(instr, index + 1) }, (_, i) => readRegister(frame, listRegister(first, i)) as JSValue);
}

/** [[Construct]] of a builtin; a user function is never constructed (the validator refuses `new F`). */
export const constructHandler: Handler = (ctx, frame, instr) => {
  const callee = readRegister(frame, operand(instr, 0));
  const args = listValues(frame, instr, 1);
  if (!(callee instanceof JSFunction) || !callee.construct) {
    throw new SimulationHalt({ kind: "unsupported", reason: "new on a value that is not a builtin constructor" });
  }
  const result = callee.construct(ctx.realm, args);
  if (isThrow(result)) return result;
  frame.accumulator = result.value;
  return undefined;
};

/**
 * Runtime functions the bytecode calls directly (src/runtime/runtime.h), by the name the listing
 * prints, plus the natives-mode probes (only a natives-mode compile emits a call to those).
 */
const RUNTIME: Readonly<Record<string, (ctx: DispatchContext, args: readonly JSValue[]) => Completion>> = {
  ThrowConstAssignError: (ctx) => ctx.realm.throwError("TypeError", formatMessage("kConstAssign")),
  ...Object.fromEntries(Object.entries(RUNTIME_NATIVE_FUNCTIONS).map(([name, run]) => [name, (ctx: DispatchContext, args: readonly JSValue[]) => run(ctx.realm, args)])),
};

export const runtimeHandler: Handler = (ctx, frame, instr) => {
  const id = instr.operands[0];
  const run = typeof id === "string" && Object.hasOwn(RUNTIME, id) ? RUNTIME[id] : undefined;
  if (!run) throw new Error(`runtime function ${String(id)} is not implemented`);
  const result = run(ctx, listValues(frame, instr, 1));
  if (isThrow(result)) return result;
  frame.accumulator = result.value;
  return undefined;
};
