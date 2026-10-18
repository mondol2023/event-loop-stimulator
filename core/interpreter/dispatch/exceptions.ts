import type { BytecodeFunction } from "@/core/bytecode/BytecodeProgram";
import { local } from "@/core/bytecode/bytecodes";
import { JSMessageObject } from "@/core/runtime/objects/JSMessageObject";
import { TheHole, isTheHole } from "@/core/runtime/values/TheHole";
import { thrown } from "../Completion";
import type { Frame } from "../Frame";
import { type Handler, accumulatorValue, contextRegister } from "./context";

// Throw, ReThrow, SetPendingMessage and the token dispatch after a finally block
// (src/interpreter/interpreter-generator.cc), plus the unwinder's handler lookup
// (HandlerTable::LookupRange in src/codegen/handler-table.cc).

/** The message Isolate::Throw records: the instruction the topmost JS frame is executing. */
export function messageAt(frame: Frame): JSMessageObject {
  return new JSMessageObject({ functionId: frame.code.id, bytecodeOffset: frame.offset });
}

export const exceptionHandler: Handler = (ctx, frame, instr) => {
  switch (instr.opcode) {
    case "Throw":
      // Runtime_Throw: a fresh exception always records where it was thrown.
      ctx.pendingMessage = messageAt(frame);
      return thrown(accumulatorValue(frame));
    case "ReThrow":
      // Runtime_ReThrow: the message the finally block restored stays as it is.
      return thrown(accumulatorValue(frame));
    case "SetPendingMessage": {
      // Swaps the accumulator with the isolate's pending message; the hole stands for "none".
      const previous = ctx.pendingMessage;
      const next = frame.accumulator;
      if (next instanceof JSMessageObject) ctx.pendingMessage = next;
      else if (isTheHole(next)) ctx.pendingMessage = undefined;
      else throw new Error("SetPendingMessage with neither a message nor the hole in the accumulator");
      frame.accumulator = previous ?? TheHole;
      return undefined;
    }
    case "SwitchOnSmiNoFeedback": {
      // The token a finally block dispatches on; a value with no case falls through.
      const token = frame.accumulator;
      const match = instr.switchTargets?.find((c) => c.caseValue === token);
      if (match) frame.next = match.target;
      return undefined;
    }
    default:
      throw new Error(`${instr.opcode} is not an exception opcode`);
  }
};

/**
 * HandlerTable::LookupRange: the innermost row whose `[start, end)` contains `offset`. Rows are
 * created outer try first, so the last match is the innermost.
 */
export function lookupHandler(code: BytecodeFunction, offset: number): { handler: number; contextRegister: number } | undefined {
  let found: { handler: number; contextRegister: number } | undefined;
  for (const entry of code.handlerTable) {
    if (entry.start <= offset && offset < entry.end) found = { handler: entry.handler, contextRegister: local(entry.data) };
  }
  return found;
}

/**
 * Enters the handler that catches an exception at `frame.offset`, as the unwinder does for an
 * interpreted frame: the context register of the try is restored and the exception lands in the
 * accumulator. Returns false when no row covers the offset, so the exception leaves the frame.
 */
export function enterHandler(frame: Frame, exception: Parameters<typeof thrown>[0]): boolean {
  const row = lookupHandler(frame.code, frame.offset);
  if (!row) return false;
  frame.context = contextRegister(frame, row.contextRegister);
  frame.accumulator = exception;
  frame.next = row.handler;
  return true;
}
