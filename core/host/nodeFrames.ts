import type { CallSite } from "@/core/runtime/stack";

// Node-internal stack frames below each kind of entry point, constants of the pinned target
// (docs/TARGET.md), recorded verbatim from the fixtures named beside each tail or probed on the
// pinned node where no fixture prints them.

/** The Node version the simulator reproduces; the error printer's last line names it. */
export const NODE_VERSION = "24.19.0";

/**
 * What runs a tick or a microtask: `nextTick` and `microtask` are processTicksAndRejections
 * (lib/internal/process/task_queues.js) running the tick queue and `runMicrotasks()`;
 * `checkpoint` is a microtask checkpoint with no tick or rejection pending, which runs the
 * microtask queue without processTicksAndRejections.
 */
export type DrainStep = "nextTick" | "microtask" | "checkpoint";

/** The functions in lib/internal/timers.js that call runNextTicks() between two callbacks. */
export type RunNextTicksCaller = "listOnTimeout" | "processTimers" | "processImmediate";

/**
 * Where the running JS was entered from. A bare DrainStep is the drain when a callback scope
 * closes (src/api/callback.cc InternalCallbackScope::Close: after the main script, and after
 * processTimers or processImmediate return); `step:caller` is the drain runNextTicks() does
 * between two timer or immediate callbacks.
 */
export type EntryPoint = "main" | "timer" | "immediate" | DrainStep | `${DrainStep}:${RunNextTicksCaller}`;

type BaseEntryPoint = "main" | "timer" | "immediate" | DrainStep;

export const NODE_FRAME_TAILS: Record<BaseEntryPoint, readonly string[]> = {
  // lib/internal/modules/cjs/loader.js, run_main.js and main/run_main_module.js (uncaught-type-error).
  main: [
    "Module._compile (node:internal/modules/cjs/loader:1872:14)",
    "Object..js (node:internal/modules/cjs/loader:2003:10)",
    "Module.load (node:internal/modules/cjs/loader:1594:32)",
    "Module._load (node:internal/modules/cjs/loader:1396:12)",
    "wrapModuleLoad (node:internal/modules/cjs/loader:255:19)",
    "Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)",
    "node:internal/main/run_main_module:33:47",
  ],
  // The callback call in processTicksAndRejections, called by C++ with `process` as the receiver (uncaught-in-nexttick).
  nextTick: ["process.processTicksAndRejections (node:internal/process/task_queues:85:11)"],
  // runMicrotasks() in processTicksAndRejections (uncaught-in-microtask).
  microtask: ["process.processTicksAndRejections (node:internal/process/task_queues:104:5)"],
  // V8's own checkpoint from C++: no JS frames below the job (probed).
  checkpoint: [],
  // lib/internal/timers.js (error-in-timer-uncaught).
  timer: ["listOnTimeout (node:internal/timers:635:17)", "process.processTimers (node:internal/timers:571:7)"],
  // lib/internal/timers.js (uncaught-in-immediate).
  immediate: ["process.processImmediate (node:internal/timers:534:21)"],
};

/** The runNextTicks() call sites (probed). */
const RUN_NEXT_TICKS_CALLERS: Record<RunNextTicksCaller, readonly string[]> = {
  listOnTimeout: ["listOnTimeout (node:internal/timers:597:9)", "process.processTimers (node:internal/timers:571:7)"],
  processTimers: ["process.processTimers (node:internal/timers:568:9)"],
  processImmediate: ["process.processImmediate (node:internal/timers:502:9)"],
};

/** Inside runNextTicks(), processTicksAndRejections is a plain call, so its frame has no `process.` (probed). */
const IN_RUN_NEXT_TICKS: Record<DrainStep, readonly string[]> = {
  nextTick: ["processTicksAndRejections (node:internal/process/task_queues:85:11)", "runNextTicks (node:internal/process/task_queues:69:3)"],
  microtask: ["processTicksAndRejections (node:internal/process/task_queues:104:5)", "runNextTicks (node:internal/process/task_queues:69:3)"],
  checkpoint: ["runNextTicks (node:internal/process/task_queues:65:5)"],
};

export function nodeFrames(entry: EntryPoint): readonly string[] {
  const colon = entry.indexOf(":");
  if (colon === -1) return NODE_FRAME_TAILS[entry as BaseEntryPoint];
  const step = entry.slice(0, colon) as DrainStep;
  const caller = entry.slice(colon + 1) as RunNextTicksCaller;
  return [...IN_RUN_NEXT_TICKS[step], ...RUN_NEXT_TICKS_CALLERS[caller]];
}

export function nodeFrameTail(entry: EntryPoint): CallSite[] {
  return nodeFrames(entry).map((native) => ({ native }));
}

/**
 * The frames of the ERR_UNHANDLED_REJECTION error processPromiseRejections throws in the default
 * `throw` mode (unhandled-rejection-non-error), below the drain it runs in: the callback scope's
 * processTicksAndRejections, or runNextTicks() inside a timer or immediate pass (probed).
 */
export function unhandledRejectionFrames(within?: RunNextTicksCaller): readonly string[] {
  const head = ["throwUnhandledRejectionsMode (node:internal/process/promises:392:7)", "processPromiseRejections (node:internal/process/promises:475:17)"];
  if (!within) return [...head, "process.processTicksAndRejections (node:internal/process/task_queues:106:37)"];
  return [
    ...head,
    "processTicksAndRejections (node:internal/process/task_queues:106:37)",
    "runNextTicks (node:internal/process/task_queues:69:3)",
    ...RUN_NEXT_TICKS_CALLERS[within],
  ];
}
