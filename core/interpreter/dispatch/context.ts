import type { Instruction } from "@/core/bytecode/BytecodeArray";
import type { BytecodeFunction } from "@/core/bytecode/BytecodeProgram";
import { Context } from "@/core/runtime/objects/Context";
import { JSMessageObject } from "@/core/runtime/objects/JSMessageObject";
import type { FunctionId } from "@/core/shared/ids";
import type { Realm } from "@/core/runtime/Realm";
import type { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSGeneratorObject, ResumeMode } from "@/core/runtime/objects/JSGeneratorObject";
import { isTheHole } from "@/core/runtime/values/TheHole";
import type { JSValue } from "@/core/runtime/values/JSValue";
import type { Completion } from "../Completion";
import { type Frame, readRegister } from "../Frame";

// What an opcode handler may use of the interpreter. A handler returns `undefined` to go on with
// the next instruction (after setting `frame.next` if it jumped), or a Completion that ends the
// frame: a `Return`'s value, or a JS exception that no handler caught.

export interface DispatchContext {
  readonly realm: Realm;
  /** The bytecode of any function in the program (a `CreateClosure` constant names one). */
  functionCode(id: FunctionId): BytecodeFunction;
  call(fn: JSFunction, receiver: JSValue, args: readonly JSValue[]): Completion;
  /** ResumeGeneratorTrampoline: re-enters a suspended function with `value` and how to resume. */
  resumeGenerator(generator: JSGeneratorObject, value: JSValue, mode: ResumeMode): Completion;
  /** The isolate's pending message: set when an exception is thrown, cleared by a handler's `SetPendingMessage`. */
  pendingMessage: JSMessageObject | undefined;
}

export type Handler = (ctx: DispatchContext, frame: Frame, instr: Instruction) => Completion | undefined;

/** The accumulator as a JS value; the hole, a Context and a message never reach an operator, so it is a bug if they do. */
export function accumulatorValue(frame: Frame): JSValue {
  const value = frame.accumulator;
  if (isTheHole(value) || value instanceof Context || value instanceof JSMessageObject) throw new Error("the accumulator holds a non-JS value where a JS value is required");
  return value;
}

/** The Context held by the register `operand` names (the current context for `<context>`). */
export function contextRegister(frame: Frame, operand: number): Context {
  const value = readRegister(frame, operand);
  if (!(value instanceof Context)) throw new Error(`register operand ${operand} does not hold a context`);
  return value;
}

/** The numeric operand `index` of `instr`; operands of these kinds are always numbers. */
export function operand(instr: Instruction, index: number): number {
  const value = instr.operands[index];
  if (typeof value !== "number") throw new Error(`${instr.opcode} operand ${index} is not a number`);
  return value;
}
