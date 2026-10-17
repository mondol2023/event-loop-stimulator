import type { Expectation } from "../../scripts/conformance/expectation.mts";
import type { FixtureMeta } from "../../scripts/conformance/fixtures.mts";
import { lineColumn } from "../../core/shared/diagnostics";
import type { SimOutput, Simulator } from "./support/simulator";

type Outcome = Expectation["outcomes"][number];

export type Comparison = { readonly ok: true } | { readonly ok: false; readonly diff: string };

/** A nondeterministic fixture must be accompanied by this fidelity warning. */
const NONDETERMINISM_WARNING = /not guaranteed/;

function show(text: string): string {
  return JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
}

/** First UTF-16 index where the two strings differ, or -1 when equal. */
function firstDifference(expected: string, actual: string): number {
  const n = Math.min(expected.length, actual.length);
  for (let i = 0; i < n; i++) if (expected.charCodeAt(i) !== actual.charCodeAt(i)) return i;
  return expected.length === actual.length ? -1 : n;
}

function lineAt(text: string, offset: number): string {
  const start = Math.max(text.lastIndexOf("\n", offset - 1) + 1, 0);
  const end = text.indexOf("\n", offset);
  return text.slice(start, end === -1 ? text.length : end);
}

function diffStream(name: "stdout" | "stderr", expected: string, actual: string): string | undefined {
  const at = firstDifference(expected, actual);
  if (at === -1) return undefined;
  // Both strings share [0, at), so either locates the same line and column.
  const { line, column } = lineColumn(expected.length >= actual.length ? expected : actual, at);
  return (
    `${name} differs at line ${line}, column ${column}:\n` +
    `  expected: ${show(lineAt(expected, at))}\n` +
    `  got:      ${show(lineAt(actual, at))}`
  );
}

function diffOutcome(sim: SimOutput, expected: Outcome): string[] {
  const problems: string[] = [];
  const stdout = diffStream("stdout", expected.stdout, sim.stdout);
  if (stdout) problems.push(stdout);
  const stderr = diffStream("stderr", expected.stderr, sim.stderr);
  if (stderr) problems.push(stderr);
  if (sim.exitCode !== expected.exitCode) {
    problems.push(`exit code: expected ${expected.exitCode}, got ${sim.exitCode}`);
  }
  return problems;
}

const REFUSAL_LINE = /^([A-Z][A-Z0-9_]*): .+$/;

/**
 * D1: a refused fixture is judged by refusal, not by stderr bytes (node's
 * stderr is its internal TypeScript loader's, which the simulator must not
 * reproduce). Real node exited non-zero; we exit 1 with `<code>: <message>`
 * lines whose first code is the fixture's declared diagnostic.
 */
function compareRefusal(sim: SimOutput, e: Expectation, diagnostic: string): Comparison {
  const problems: string[] = [];
  if (!e.outcomes.every((o) => o.exitCode !== 0)) {
    problems.push(`fixture "${e.fixture}" is declared refused, but real node did not exit non-zero`);
  }
  if (sim.exitCode !== 1) problems.push(`exit code: expected 1 (refusal), got ${sim.exitCode}`);
  const lines = sim.stderr.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const codes = lines.map((l) => REFUSAL_LINE.exec(l)?.[1]);
  if (lines.length === 0 || codes.some((c) => c === undefined)) {
    problems.push(`stderr is not "<code>: <message>" lines: ${show(sim.stderr)}`);
  } else if (codes[0] !== diagnostic) {
    problems.push(`diagnostic: expected ${diagnostic}, got ${codes[0]}`);
  }
  return problems.length === 0 ? { ok: true } : { ok: false, diff: problems.join("\n") };
}

/**
 * Byte-equal to the single recorded outcome. For a nondeterministic fixture
 * the output must equal ONE of the recorded outcomes (all three channels of
 * the same one) AND the run must have warned that the order is not guaranteed.
 * A run that stopped early never conforms (D3), and a refused fixture follows D1.
 */
export function compareToExpectation(sim: SimOutput, e: Expectation, meta: FixtureMeta = {}): Comparison {
  if (sim.stop) {
    return { ok: false, diff: `simulation stopped (${sim.stop.kind}: ${sim.stop.detail}); real node ran to completion` };
  }
  if (meta.expect === "refused" && meta.diagnostic !== undefined) return compareRefusal(sim, e, meta.diagnostic);
  if (!e.nondeterministic) {
    const problems = diffOutcome(sim, e.outcomes[0] as Outcome);
    return problems.length === 0 ? { ok: true } : { ok: false, diff: problems.join("\n") };
  }

  const problems: string[] = [];
  if (!sim.warnings.some((w) => NONDETERMINISM_WARNING.test(w))) {
    problems.push(
      `fixture "${e.fixture}" is nondeterministic on real node, but the run raised no fidelity warning matching /not guaranteed/`,
    );
  }
  if (!e.outcomes.some((o) => diffOutcome(sim, o).length === 0)) {
    problems.push(
      `output matches none of the ${e.outcomes.length} recorded outcomes; closest-by-position diff against the first:\n` +
        diffOutcome(sim, e.outcomes[0] as Outcome).join("\n"),
    );
  }
  return problems.length === 0 ? { ok: true } : { ok: false, diff: problems.join("\n") };
}

/**
 * The fixtures that are still `it.todo` although a simulator exists. Phase 3
 * cannot set SIMULATOR and forget to turn the todos into real comparisons:
 * fixtures.test.ts fails on a non-empty result.
 */
export function pendingSimulatorTodos(simulator: Simulator | undefined, todoFixtures: readonly string[]): string[] {
  return simulator === undefined ? [] : [...todoFixtures];
}
