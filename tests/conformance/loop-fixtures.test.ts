import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { simulate } from "@/core/timeline/simulate";
import { parseExpectation } from "../../scripts/conformance/expectation.mts";

// The nondeterministic loop fixtures, beyond "matches one recorded outcome and warns"
// (fixtures.test.ts): which outcome the simulator picks, and that a deterministic ordering next
// to them raises no warning.

const FIXTURES = join(__dirname, "fixtures");
const fixtureSource = (name: string): string => readFileSync(join(FIXTURES, `${name}.cjs`), "utf8");
const outcomes = (name: string) =>
  parseExpectation(JSON.parse(readFileSync(join(FIXTURES, `${name}.expected.json`), "utf8"))).outcomes;

const NOT_GUARANTEED = /not guaranteed/;

describe("nondeterministic orderings in Node's loop", () => {
  it("timeout-vs-immediate-main picks outcomes[0] and warns that the order is not guaranteed", () => {
    const sim = simulate(fixtureSource("timeout-vs-immediate-main"), "js");
    expect(sim.stop).toBeUndefined();
    expect({ stdout: sim.stdout, stderr: sim.stderr, exitCode: sim.exitCode }).toEqual(outcomes("timeout-vs-immediate-main")[0]);
    expect(sim.warnings).toEqual([
      "Order not guaranteed in real Node: whether the 1 ms timer is due before the first loop iteration depends on how long startup took.",
    ]);
  });

  it("immediate-vs-timeout-in-io-free-callback is deterministic: no warning", () => {
    const sim = simulate(fixtureSource("immediate-vs-timeout-in-io-free-callback"), "js");
    expect(sim.stdout).toBe(outcomes("immediate-vs-timeout-in-io-free-callback")[0]?.stdout);
    expect(sim.warnings).toEqual([]);
  });

  it("timer-in-timer-ordering matches a recorded outcome and warns", () => {
    const sim = simulate(fixtureSource("timer-in-timer-ordering"), "js");
    expect(outcomes("timer-in-timer-ordering").map((o) => o.stdout)).toContain(sim.stdout);
    expect(sim.warnings.some((w) => NOT_GUARANTEED.test(w))).toBe(true);
  });

  it("deterministic timer fixtures raise no warning", () => {
    for (const name of ["timers-same-expiry-order", "interval-clear", "drain-after-each-callback", "promise-vs-timeout"]) {
      expect(simulate(fixtureSource(name), "js").warnings, name).toEqual([]);
    }
  });
});
