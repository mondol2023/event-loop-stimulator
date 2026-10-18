import type { Opcode } from "@/core/bytecode/bytecodes";
import type { JobKind } from "@/core/runtime/MicrotaskQueue";
import type { TaskId } from "@/core/shared/ids";
import type { BytecodePos } from "@/core/views/types";

// What the interpreter and the host report as they step (PROMPT.md §7.5). Every Command becomes
// a Tick in the TickRecorder (Task 19), which extends this union with phase, GC and exit
// commands; this is the part the interpreter and the microtask queue emit.

export type Command =
  | {
      /** One bytecode dispatch, reported before the instruction executes. */
      readonly kind: "dispatch";
      readonly pos: BytecodePos;
      readonly opcode: Opcode;
    }
  | {
      /** A microtask job starts (HostHooks microtask checkpoint). */
      readonly kind: "job-start";
      readonly jobId: TaskId;
      readonly jobKind: JobKind;
      readonly label: string;
    }
  | {
      /** The job that started last has finished. */
      readonly kind: "job-end";
      readonly jobId: TaskId;
    };
