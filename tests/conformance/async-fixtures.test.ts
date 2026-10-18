import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { simulate } from "@/core/timeline/simulate";
import { parseExpectation } from "../../scripts/conformance/expectation.mts";
import { runReal } from "../../scripts/conformance/run-real.mts";
import { checkPinnedRuntime, readTarget } from "../../scripts/conformance/target.mts";

// Async functions before the Node loop exists (Task 16). Two recorded fixtures need more than the
// microtask queue: async-await-order has a setTimeout, and uncaught-after-await ends in an
// unhandled rejection whose stderr is printed by Node's rejection processing (Task 17). The first
// runs without its timer on real node and on the simulator; the second has its stdout compared
// with the recording. (Both replay whole once Task 17 lands.)

const problems = checkPinnedRuntime({ node: process.versions.node, v8: process.versions.v8 }, readTarget());
const pinned = problems.length === 0;
if (!pinned) console.warn(`Skipping real-node async comparisons: ${problems.join("; ")} (docs/TARGET.md)`);

const FIXTURES = join(__dirname, "fixtures");
const fixtureSource = (name: string): string => readFileSync(join(FIXTURES, `${name}.cjs`), "utf8");

const TIMER_LINE = 'setTimeout(() => console.log("setTimeout"), 0);\n';

function withoutTimer(source: string): string {
  if (!source.includes(TIMER_LINE)) throw new Error("async-await-order no longer contains its setTimeout line");
  return source.replace(TIMER_LINE, "");
}

describe.skipIf(!pinned)("async functions equal real node", () => {
  it("async-await-order without its setTimeout", () => {
    const source = withoutTimer(fixtureSource("async-await-order"));
    expect(source).not.toMatch(/setTimeout|setInterval|setImmediate|nextTick/);
    const real = runReal(source, { lang: "js" });
    const sim = simulate(source, "js");
    expect(sim.stop, `the simulator stopped early: ${JSON.stringify(sim.stop)}`).toBeUndefined();
    expect({ stdout: sim.stdout, stderr: sim.stderr, exitCode: sim.exitCode }).toEqual(real);
  });
});

describe("uncaught-after-await", () => {
  it("prints the recorded stdout (its stderr is Task 17's rejection processing)", () => {
    const expectation = parseExpectation(JSON.parse(readFileSync(join(FIXTURES, "uncaught-after-await.expected.json"), "utf8")));
    const sim = simulate(fixtureSource("uncaught-after-await"), "js");
    expect(sim.stop).toBeUndefined();
    expect(sim.stdout).toBe(expectation.outcomes[0]?.stdout);
  });
});
