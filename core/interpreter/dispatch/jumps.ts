import { HeapObject } from "@/core/runtime/objects/HeapObject";
import { ToBoolean } from "@/core/runtime/spec/conversions";
import { type Handler, accumulatorValue } from "./context";

// Jump* opcodes. The builder already resolved each target to an absolute offset, for the
// immediate and the constant-pool forms alike, so a jump only decides whether to take it.
// `JumpLoop` is an unconditional back edge (its interrupt and OSR checks are not modeled).

export const jumpHandler: Handler = (ctx, frame, instr) => {
  const target = instr.jumpTarget;
  if (target === undefined) throw new Error(`${instr.opcode} has no resolved jump target`);
  const name = instr.opcode.replace(/Constant$/, "");
  const taken = (): boolean => {
    switch (name) {
      case "Jump":
      case "JumpLoop":
        return true;
      case "JumpIfTrue":
        return frame.accumulator === true;
      case "JumpIfFalse":
        return frame.accumulator === false;
      case "JumpIfToBooleanTrue":
        return ToBoolean(accumulatorValue(frame));
      case "JumpIfToBooleanFalse":
        return !ToBoolean(accumulatorValue(frame));
      case "JumpIfNull":
        return frame.accumulator === null;
      case "JumpIfNotNull":
        return frame.accumulator !== null;
      case "JumpIfUndefined":
        return frame.accumulator === undefined;
      case "JumpIfNotUndefined":
        return frame.accumulator !== undefined;
      case "JumpIfUndefinedOrNull":
        return frame.accumulator === undefined || frame.accumulator === null;
      case "JumpIfJSReceiver":
        return frame.accumulator instanceof HeapObject;
      default:
        throw new Error(`${instr.opcode} is not a jump this interpreter implements`);
    }
  };
  if (!taken()) return undefined;
  frame.next = target;
  if (instr.opcode === "JumpLoop") {
    ctx.tiering.onBackEdge({ functionId: frame.code.id, bytecodeLength: frame.code.array.length, bytecodeOffset: instr.offset, loopHeaderOffset: target });
  }
  return undefined;
};
