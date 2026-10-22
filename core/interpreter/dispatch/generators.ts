import type { Instruction } from "@/core/bytecode/BytecodeArray";
import { PerformPromiseThen, PromiseResolve, RejectPromise, ResolvePromise } from "@/core/runtime/builtins/Promise";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import { JSAsyncFunctionObject, JSGeneratorObject, ResumeMode, kGeneratorExecuting } from "@/core/runtime/objects/JSGeneratorObject";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { type Completion, normal } from "../Completion";
import { type Frame, listRegister, readRegister, writeRegister } from "../Frame";
import { type DispatchContext, type Handler, accumulatorValue, operand } from "./context";

// The generator machinery async functions run on (src/interpreter/interpreter-generator.cc:
// SwitchOnGeneratorState, SuspendGenerator, ResumeGenerator) and the intrinsics the bytecode
// generator's async prologue, await and epilogue call (src/builtins/builtins-async-function-gen.cc,
// src/builtins/builtins-async-gen.cc, src/runtime/runtime-generator.cc).

function generatorIn(frame: Frame, register: number): JSGeneratorObject {
  const value = readRegister(frame, register);
  if (!(value instanceof JSGeneratorObject)) throw new Error(`register ${register} does not hold a generator object`);
  return value;
}

/** The registers of a RegList operand pair starting at `index`. */
function registerList(instr: Instruction, index: number): number[] {
  const first = operand(instr, index);
  return Array.from({ length: operand(instr, index + 1) }, (_, i) => listRegister(first, i));
}

export const generatorHandler: Handler = (ctx, frame, instr) => {
  switch (instr.opcode) {
    case "SwitchOnGeneratorState": {
      // A fresh call has `undefined` in the generator register and falls through to the prologue.
      const value = readRegister(frame, operand(instr, 0));
      if (value === undefined) return undefined;
      const generator = generatorIn(frame, operand(instr, 0));
      const state = generator.continuation;
      generator.continuation = kGeneratorExecuting;
      frame.context = generator.context;
      const match = instr.switchTargets?.find((c) => c.caseValue === state);
      if (!match) throw new Error(`a generator resumed in state ${state}, which its jump table has no case for`);
      frame.next = match.target;
      return undefined;
    }
    case "SuspendGenerator": {
      // Exports the parameters and the live registers, records where to resume and the context,
      // and returns the accumulator to whoever called or resumed the function.
      const generator = generatorIn(frame, operand(instr, 0));
      generator.parameters = [...frame.args];
      generator.registers = registerList(instr, 1).map((r) => readRegister(frame, r));
      generator.continuation = operand(instr, 3);
      generator.context = frame.context;
      return normal(accumulatorValue(frame));
    }
    case "ResumeGenerator": {
      // Imports the saved registers; the value the function was resumed with goes to the accumulator.
      const generator = generatorIn(frame, operand(instr, 0));
      registerList(instr, 1).forEach((r, i) => writeRegister(frame, r, generator.registers[i]));
      frame.accumulator = generator.inputOrDebugPos;
      return undefined;
    }
    case "InvokeIntrinsic":
      return invokeIntrinsic(ctx, frame, instr);
    default:
      throw new Error(`${instr.opcode} is not a generator opcode`);
  }
};

function invokeIntrinsic(ctx: DispatchContext, frame: Frame, instr: Instruction): Completion | undefined {
  const id = instr.operands[0];
  const args = registerList(instr, 1).map((r) => readRegister(frame, r));
  const realm = ctx.realm;
  const asyncFunction = (): JSAsyncFunctionObject => {
    const generator = args[0];
    if (!(generator instanceof JSAsyncFunctionObject)) throw new Error(`${String(id)} without an async function object`);
    return generator;
  };
  switch (id) {
    case "_AsyncFunctionEnter": {
      // AsyncFunctionEnter: the promise the call returns, and the generator object that holds it.
      const closure = args[0];
      if (!(closure instanceof JSFunction)) throw new Error("_AsyncFunctionEnter without a closure");
      const promise = realm.newPromise();
      frame.accumulator = realm.heap.allocate(
        (oid) => new JSAsyncFunctionObject(oid, realm.maps.rootFor("generator", 0), null, closure, args[1] as JSValue, frame.context, promise),
      );
      return undefined;
    }
    case "_AsyncFunctionAwait": {
      // Await(value): PromiseResolve(%Promise%, value), then PerformPromiseThen with the resume
      // closures and no derived promise. The outer promise comes back for SuspendGenerator to return.
      const generator = asyncFunction();
      const promise = PromiseResolve(realm, args[1] as JSValue);
      const resume = (mode: ResumeMode) =>
        realm.internalFunction("", 1, (_r, _receiver, values) => ctx.resumeGenerator(generator, values[0], mode), [generator]);
      PerformPromiseThen(realm, promise, resume(ResumeMode.kNext), resume(ResumeMode.kThrow), undefined);
      frame.accumulator = generator.promise;
      return undefined;
    }
    case "_AsyncFunctionResolve": {
      const generator = asyncFunction();
      ResolvePromise(realm, generator.promise, args[1] as JSValue);
      frame.accumulator = generator.promise;
      return undefined;
    }
    case "_AsyncFunctionReject": {
      const generator = asyncFunction();
      RejectPromise(realm, generator.promise, args[1] as JSValue);
      frame.accumulator = generator.promise;
      return undefined;
    }
    case "_GeneratorGetResumeMode": {
      const generator = args[0];
      if (!(generator instanceof JSGeneratorObject)) throw new Error("_GeneratorGetResumeMode without a generator object");
      frame.accumulator = generator.resumeMode;
      return undefined;
    }
    default:
      throw new Error(`intrinsic ${String(id)} is not implemented`);
  }
}
