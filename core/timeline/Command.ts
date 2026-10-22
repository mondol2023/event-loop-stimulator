import type { Opcode } from "@/core/bytecode/bytecodes";
import type { TaskId } from "@/core/shared/ids";
import type { BytecodePos } from "@/core/views/types";

// What the interpreter and the host report as they step (PROMPT.md §7.5). The TickRecorder turns
// the commands that make a tick into Ticks; the rest only move its bookkeeping.

/** libuv's loop phases (deps/uv/src/unix/core.c uv_run), as Node's loop walks them. */
export type LoopPhase = "timers" | "pending" | "poll" | "check" | "close";

/** What a queued task is: V8's three job kinds, or one of Node's own queues. */
export type TaskKind = "PromiseReactionJob" | "PromiseResolveThenableJob" | "CallbackJob" | "nextTick" | "timeout" | "interval" | "immediate";

/** One queued task as the timeline names it. */
export type TaskRef = {
  readonly id: TaskId;
  readonly kind: TaskKind;
  /** What the learner sees: `setTimeout(tick, 100)`, `process.nextTick(f)`, `PromiseReactionJob`. */
  readonly label: string;
  /** What queued it, as the narration says it: `PerformPromiseThen`, `process.nextTick`, `setTimeout`. */
  readonly origin: string;
};

/** The queue whose task starts: Node's nextTick queue, V8's microtask queue, or a libuv phase's callbacks. */
export type JobQueue = "nextTick" | "microtask" | "timers" | "check";

/** A modeled garbage collection (Illustrative: addresses and timings never reach the Exact layer). */
export type GcEvent = {
  readonly type: "scavenge" | "mark-compact";
  readonly freedObjects: number;
  readonly promotedObjects: number;
};

export type Command =
  | {
      /** One bytecode dispatch, reported before the instruction executes. */
      readonly kind: "dispatch";
      readonly pos: BytecodePos;
      readonly opcode: Opcode;
    }
  | {
      /** A task starts: a nextTick callback, a microtask job, a timer or an immediate. */
      readonly kind: "job-start";
      readonly queue: JobQueue;
      readonly task: TaskRef;
    }
  | {
      /** The task that started last has finished. */
      readonly kind: "job-end";
      readonly task: TaskRef;
    }
  | {
      /** libuv enters a phase of its loop. */
      readonly kind: "loop-phase";
      readonly phase: LoopPhase;
    }
  | {
      /** A garbage collection ran (Task 21). */
      readonly kind: "gc";
      readonly event: GcEvent;
    }
  | {
      /** The process exits with `code`. */
      readonly kind: "exit";
      readonly code: number;
    };
