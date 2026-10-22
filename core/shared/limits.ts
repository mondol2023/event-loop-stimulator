// The simulation limits (PROMPT.md §7.1, Decision D3). They live in core/shared because the
// runtime, interpreter and host each enforce one and may not import core/timeline; the
// timeline re-exports them from core/timeline/limits.ts.

export const LIMITS = {
  /** Ticks (one per dispatch, job start, loop-phase transition, GC event and exit; Decision D4). */
  ticks: 5000,
  /** User JS frames active at once, the wrapper included. */
  callDepth: 64,
  /** JS-visible allocations, cumulative. */
  heapObjects: 1024,
  /** The longest virtual run, in ms; timers due at or before it still fire. */
  virtualTimeMs: 60000,
  /** Element visits inside builtins (a `map` over `length = 2**32 - 1`); an addition to §7.1. */
  work: 1_000_000,
  /**
   * Characters written to stdout and stderr together; an addition to §7.1. With `stringChars` it
   * bounds the memory of the host running the model: a worker thread that runs out of heap on a
   * huge string can abort its whole process, not only itself.
   */
  outputChars: 1_048_576,
  /** Characters of every string the program builds by concatenation or `join`, cumulative; an addition to §7.1. */
  stringChars: 8_388_608,
} as const;

/** Written to `warnings` (never to stdout or stderr) when a run hits a limit. */
export const SIMULATION_LIMIT_NOTICE = "Simulation limit reached — real Node would continue";
