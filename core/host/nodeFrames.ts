import type { CallSite } from "@/core/runtime/stack";

// Node-internal stack frames below each kind of entry point, constants of the pinned target
// (docs/TARGET.md), recorded verbatim from the fixtures named beside each tail.

/** The Node version the simulator reproduces; the error printer's last line names it. */
export const NODE_VERSION = "24.19.0";

/**
 * Where the running JS was entered from. `microtask` is a job run by the microtask checkpoint in
 * processTicksAndRejections (after the main script or a nextTick); other checkpoints have other tails.
 */
export type EntryPoint = "main" | "nextTick" | "microtask" | "timer" | "immediate";

export const NODE_FRAME_TAILS: Record<EntryPoint, readonly string[]> = {
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
  // lib/internal/process/task_queues.js, the callback call in processTicksAndRejections (uncaught-in-nexttick).
  nextTick: ["process.processTicksAndRejections (node:internal/process/task_queues:85:11)"],
  // lib/internal/process/task_queues.js, runMicrotasks() in processTicksAndRejections (uncaught-in-microtask).
  microtask: ["process.processTicksAndRejections (node:internal/process/task_queues:104:5)"],
  // lib/internal/timers.js (error-in-timer-uncaught).
  timer: ["listOnTimeout (node:internal/timers:635:17)", "process.processTimers (node:internal/timers:571:7)"],
  // lib/internal/timers.js (uncaught-in-immediate).
  immediate: ["process.processImmediate (node:internal/timers:534:21)"],
};

export function nodeFrameTail(entry: EntryPoint): CallSite[] {
  return NODE_FRAME_TAILS[entry].map((native) => ({ native }));
}
