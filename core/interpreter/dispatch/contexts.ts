import { Context } from "@/core/runtime/objects/Context";
import { formatMessage } from "@/core/runtime/messages";
import { isTheHole } from "@/core/runtime/values/TheHole";
import { type Frame, readRegister, writeRegister } from "../Frame";
import { type Handler, contextRegister, operand } from "./context";

// Closures, contexts and the temporal dead zone (src/interpreter/interpreter-generator.cc).
// A context slot operand is absolute; `LdaContextSlot reg, idx, depth` walks `depth` previous links.

/** The name a hole check reports: a string constant of the running function. */
function nameOperand(frame: Frame, index: number): string {
  const entry = frame.code.constantPool.get(index);
  if (entry?.kind !== "string") throw new Error(`constant ${index} is not a name`);
  return entry.value;
}

export const contextHandler: Handler = (ctx, frame, instr) => {
  switch (instr.opcode) {
    case "CreateClosure": {
      // The closure site's feedback cell is shared by every closure made there (CreateClosure's slot).
      const entry = frame.code.constantPool.get(operand(instr, 0));
      if (entry?.kind !== "sfi") throw new Error("CreateClosure does not name a shared function info");
      const cell = frame.fn.feedbackCell.closureCell(operand(instr, 1));
      frame.accumulator = ctx.realm.userFunction(ctx.functionCode(entry.functionId), frame.context, cell);
      return undefined;
    }
    case "CreateFunctionContext":
      frame.accumulator = new Context(frame.context, operand(instr, 1));
      return undefined;
    case "CreateBlockContext":
      frame.accumulator = new Context(frame.context, 0);
      return undefined;
    case "CreateCatchContext": {
      // The exception sits in the first variable slot; the catch variable reads it from there.
      const catchContext = new Context(frame.context, 1);
      catchContext.store(2, readRegister(frame, operand(instr, 0)));
      frame.accumulator = catchContext;
      return undefined;
    }
    case "PushContext":
      writeRegister(frame, operand(instr, 0), frame.context);
      frame.context = contextOf(frame);
      return undefined;
    case "PopContext":
      frame.context = contextRegister(frame, operand(instr, 0));
      return undefined;
    case "LdaCurrentContextSlot":
    case "LdaImmutableCurrentContextSlot":
      frame.accumulator = frame.context.load(operand(instr, 0));
      return undefined;
    case "LdaContextSlot":
    case "LdaImmutableContextSlot":
      frame.accumulator = contextRegister(frame, operand(instr, 0)).ancestor(operand(instr, 2)).load(operand(instr, 1));
      return undefined;
    case "StaCurrentContextSlot":
      frame.context.store(operand(instr, 0), frame.accumulator);
      return undefined;
    case "StaContextSlot":
      contextRegister(frame, operand(instr, 0)).ancestor(operand(instr, 2)).store(operand(instr, 1), frame.accumulator);
      return undefined;
    case "ThrowReferenceErrorIfHole":
      if (!isTheHole(frame.accumulator)) return undefined;
      return ctx.realm.throwError("ReferenceError", formatMessage("kAccessedUninitializedVariable", nameOperand(frame, operand(instr, 0))));
    default:
      throw new Error(`${instr.opcode} is not a context opcode`);
  }
};

/** The context PushContext installs: the accumulator, which a Create*Context just made. */
function contextOf(frame: Frame): Context {
  const created = frame.accumulator;
  if (!(created instanceof Context)) throw new Error("PushContext without a context in the accumulator");
  return created;
}
