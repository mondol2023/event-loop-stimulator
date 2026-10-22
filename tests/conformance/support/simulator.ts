import { simulate, type SimulationOptions } from "@/core/timeline/simulate";

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

/** One run of `core/timeline/simulate`, in the shape the comparison reads. */
export function simulatorRun(fixture: { readonly source: string; readonly lang: "js" | "ts" }, opts: SimulationOptions = {}): SimOutput {
  const r = simulate(fixture.source, fixture.lang, { ...opts, record: false });
  const out = { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, warnings: r.warnings };
  if (!r.stop) return out;
  return { ...out, stop: { kind: r.stop.kind, detail: r.stop.kind === "limit" ? r.stop.limit : r.stop.reason } };
}

/** The real simulator: `core/timeline/simulate` without recording a timeline (the firewall test proves recording changes no output). */
export const SIMULATOR: Simulator = { run: (source, lang) => simulatorRun({ source, lang }) };
