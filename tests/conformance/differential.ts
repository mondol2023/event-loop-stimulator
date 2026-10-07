import fc from "fast-check";
import { type RealRun, runReal as spawnReal } from "../../scripts/conformance/run-real.mts";
import { minimizeProgram, programModelArbitrary, renderProgram } from "./generator/programs";
import type { Simulator } from "./support/simulator";

// The differential property (PROMPT.md §3.4): for every generated program, a simulator's
// output equals real Node's. Real Node is only ever run on generated programs.
//
// A program on which real Node itself disagrees with itself is discarded: no simulator
// can be held to an output that is not stable. Otherwise a mismatch fails with the
// shrunk program and the first differing line.

export type DifferentialOptions = {
  /** Programs to try. Defaults to `CONFORMANCE_RUNS`, else 25. */
  readonly numRuns?: number;
  /** Replays a failure; printed in the failure message. */
  readonly seed?: number;
  /** Injected for tests; defaults to spawning the pinned node. */
  readonly runReal?: (source: string) => RealRun;
  /** Real-node re-runs that decide whether a mismatching program is stable. Defaults to 5. */
  readonly stabilityReruns?: number;
};

export type DifferentialStats = { readonly runs: number; readonly discarded: number };

export const DEFAULT_RUNS = 25;
export const STABILITY_RERUNS = 5;

export class DifferentialMismatch extends Error {
  override name = "DifferentialMismatch";
  constructor(
    readonly source: string,
    readonly diff: string,
    readonly seed: number,
  ) {
    super(`simulator output differs from real node (seed ${seed}) for this program:\n${source}\n${diff}`);
  }
}

function configuredRuns(): number {
  const raw = process.env["CONFORMANCE_RUNS"];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RUNS;
}

const sameRun = (a: RealRun, b: RealRun): boolean => a.stdout === b.stdout && a.stderr === b.stderr && a.exitCode === b.exitCode;

/** First difference between two outputs of the same stream, as "<stream> differs at line L, column C: …". */
function diffStream(name: string, expected: string, actual: string): string | undefined {
  if (expected === actual) return undefined;
  let at = 0;
  while (at < expected.length && at < actual.length && expected.charCodeAt(at) === actual.charCodeAt(at)) at++;
  const before = expected.slice(0, at);
  const line = before.split("\n").length;
  const column = at - (before.lastIndexOf("\n") + 1);
  const lineOf = (text: string) => {
    const start = text.lastIndexOf("\n", at - 1) + 1;
    const end = text.indexOf("\n", at);
    return JSON.stringify(text.slice(start, end === -1 ? text.length : end));
  };
  return `${name} differs at line ${line}, column ${column}:\n  real node: ${lineOf(expected)}\n  simulator: ${lineOf(actual)}`;
}

function describeDifference(real: RealRun, sim: RealRun): string {
  const parts = [diffStream("stdout", real.stdout, sim.stdout), diffStream("stderr", real.stderr, sim.stderr)];
  if (real.exitCode !== sim.exitCode) parts.push(`exit code: real node ${real.exitCode}, simulator ${sim.exitCode}`);
  return parts.filter((p) => p !== undefined).join("\n");
}

type Verdict = { readonly kind: "same" } | { readonly kind: "unstable" } | { readonly kind: "mismatch"; readonly diff: string };

export function differentialProperty(sim: Simulator, opts: DifferentialOptions = {}): DifferentialStats {
  const numRuns = opts.numRuns ?? configuredRuns();
  const seed = opts.seed ?? Math.floor(Math.random() * 0x7fffffff);
  const real = opts.runReal ?? ((source: string) => spawnReal(source, { lang: "js" }));
  const reruns = opts.stabilityReruns ?? STABILITY_RERUNS;
  let discarded = 0;

  const judge = (source: string): Verdict => {
    const expected = real(source);
    const actual = sim.run(source, "js");
    if (sameRun(expected, actual)) return { kind: "same" };
    for (let i = 0; i < reruns; i++) {
      if (!sameRun(expected, real(source))) return { kind: "unstable" };
    }
    return { kind: "mismatch", diff: describeDifference(expected, actual) };
  };

  const property = fc.property(programModelArbitrary, (program) => {
    const verdict = judge(renderProgram(program));
    if (verdict.kind === "unstable") discarded++;
    return verdict.kind !== "mismatch";
  });

  const details = fc.check(property, { numRuns, seed });
  if (!details.failed) return { runs: details.numRuns, discarded };

  // A throw from the simulator or the runner (not a mismatch) is reported as itself.
  const counterexample = details.counterexample?.[0];
  if (counterexample === undefined) throw details.errorInstance instanceof Error ? details.errorInstance : new Error("property failed");
  const shrunk = minimizeProgram(counterexample, (source) => judge(source).kind === "mismatch");
  const source = renderProgram(shrunk);
  const verdict = judge(source);
  throw new DifferentialMismatch(source, verdict.kind === "mismatch" ? verdict.diff : "", seed);
}
