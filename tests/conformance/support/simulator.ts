// The contract Phase 3's IgnitionInterpreter + Node event loop implements, and
// the single slot the conformance suite reads it from.

/** Why a run ended early (Decision D3). Real node would have run on, so a stopped run never conforms. */
export type SimulationStopSummary = { readonly kind: "limit" | "unsupported"; readonly detail: string };

export type SimOutput = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** Fidelity warnings the run produced (e.g. a nondeterministic ordering); never part of stdout/stderr. */
  readonly warnings: readonly string[];
  readonly stop?: SimulationStopSummary;
};

export interface Simulator {
  run(source: string, lang: "js" | "ts"): SimOutput;
}

/**
 * Phase 3 sets this to the real simulator. While it is `undefined`, every
 * "simulator output equals real node" test is an `it.todo`; once it is set,
 * fixtures.test.ts fails until those todos are replaced by real comparisons.
 */
export const SIMULATOR: Simulator | undefined = undefined;
