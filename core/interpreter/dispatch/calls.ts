import type { Instruction } from "@/core/bytecode/BytecodeArray";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { isThrow } from "../Completion";
import { listRegister, readRegister } from "../Frame";
import { type Handler, operand } from "./context";

// Call opcodes (src/interpreter/bytecodes.h). The callee is always a register; the receiver is
// `undefined` for CallUndefinedReceiver* and the first register of the argument list for
// CallProperty*. Task 9 adds the CallPrinter text of "x is not a function", the sloppy `this`
// coercion and the call-depth limit.

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
    throw new SimulationHalt({ kind: "unsupported", reason: "calling a value that is not a function (the TypeError text arrives with Task 9)" });
  }
  const result = ctx.call(callee, receiver, args);
  if (isThrow(result)) return result;
  frame.accumulator = result.value;
  return undefined;
};
