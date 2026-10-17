import type { Opcode } from "@/core/bytecode/bytecodes";
import type { BytecodePos } from "@/core/views/types";

// What the interpreter and the host report as they step (PROMPT.md §7.5). Every Command becomes
// a Tick in the TickRecorder (Task 19), which extends this union with job, phase, GC and exit
// commands; this is the part the interpreter itself emits.

export type Command = {
  /** One bytecode dispatch, reported before the instruction executes. */
  readonly kind: "dispatch";
  readonly pos: BytecodePos;
  readonly opcode: Opcode;
};
