import type { BytecodeFunction } from "@/core/bytecode/BytecodeProgram";
import { CLOSURE, CURRENT_CONTEXT, THIS } from "@/core/bytecode/bytecodes";
import type { Context } from "@/core/runtime/objects/Context";
import type { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSValue, RegisterValue } from "@/core/runtime/values/JSValue";

// One activation of a user function (V8's InterpretedFrame): the register file, the accumulator,
// and the offset of the instruction being run. A register operand is an offset from V8's frame
// pointer (see bytecodes.ts): locals r0, r1, … count down from -7, arguments a0, a1, … up from 3.

const FIRST_LOCAL = -7;
const FIRST_ARGUMENT = 3;

export class Frame {
  readonly fn: JSFunction;
  readonly code: BytecodeFunction;
  readonly registers: RegisterValue[];
  /** The formal parameters after the receiver; missing arguments are `undefined`, extra ones are dropped. */
  readonly args: JSValue[];
  /** Every argument the call passed (the arguments object's elements). */
  readonly actualArgs: readonly JSValue[];
  accumulator: RegisterValue = undefined;
  context: Context;
  receiver: JSValue;
  /** Offset of the instruction being executed (what a stack trace and a Command name). */
  offset = 0;
  /** Offset of the instruction that runs next; a jump overwrites it. */
  next = 0;
  /** The frame runs a [[Construct]] (`new F`): its stack-trace entry reads `new F`. */
  isConstruct = false;

  constructor(fn: JSFunction, code: BytecodeFunction, receiver: JSValue, args: readonly JSValue[]) {
    this.fn = fn;
    this.code = code;
    this.context = fn.context;
    this.receiver = receiver;
    this.registers = new Array<RegisterValue>(code.registerCount).fill(undefined);
    this.args = Array.from({ length: Math.max(code.parameterCount - 1, 0) }, (_, i) => args[i]);
    this.actualArgs = args;
  }
}

/** The value of the register named by `operand`. */
export function readRegister(frame: Frame, operand: number): RegisterValue {
  if (operand <= FIRST_LOCAL) return frame.registers[FIRST_LOCAL - operand];
  if (operand >= FIRST_ARGUMENT) return frame.args[operand - FIRST_ARGUMENT];
  if (operand === THIS) return frame.receiver;
  if (operand === CURRENT_CONTEXT) return frame.context;
  if (operand === CLOSURE) return frame.fn;
  throw new Error(`${operand} is not a register operand`);
}

export function writeRegister(frame: Frame, operand: number, value: RegisterValue): void {
  if (operand <= FIRST_LOCAL) frame.registers[FIRST_LOCAL - operand] = value;
  else if (operand >= FIRST_ARGUMENT) frame.args[operand - FIRST_ARGUMENT] = value as JSValue;
  else throw new Error(`register operand ${operand} is not writable`);
}

/** The `index`-th register of a register list that starts at `first` (list registers are consecutive locals). */
export function listRegister(first: number, index: number): number {
  return first - index;
}
