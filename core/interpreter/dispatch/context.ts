import type { Instruction } from "@/core/bytecode/BytecodeArray";
import type { Realm } from "@/core/runtime/Realm";
import type { JSFunction } from "@/core/runtime/objects/JSFunction";
import { isTheHole } from "@/core/runtime/values/TheHole";
import type { JSValue } from "@/core/runtime/values/JSValue";
import type { Completion } from "../Completion";
import type { Frame } from "../Frame";

// What an opcode handler may use of the interpreter. A handler returns `undefined` to go on with
// the next instruction (after setting `frame.next` if it jumped), or a Completion that ends the
// frame: a `Return`'s value, or a JS exception that no handler caught.

export interface DispatchContext {
  readonly realm: Realm;
  call(fn: JSFunction, receiver: JSValue, args: readonly JSValue[]): Completion;
}

export type Handler = (ctx: DispatchContext, frame: Frame, instr: Instruction) => Completion | undefined;

/** The accumulator as a JS value; the hole never reaches an operator, so it is a bug if it does. */
export function accumulatorValue(frame: Frame): JSValue {
  const value = frame.accumulator;
  if (isTheHole(value)) throw new Error("the accumulator holds the_hole where a JS value is required");
  return value;
}

/** The numeric operand `index` of `instr`; operands of these kinds are always numbers. */
export function operand(instr: Instruction, index: number): number {
  const value = instr.operands[index];
  if (typeof value !== "number") throw new Error(`${instr.opcode} operand ${index} is not a number`);
  return value;
}
