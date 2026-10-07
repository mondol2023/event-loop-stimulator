import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { stripTypes } from "@/core/frontend/strip-types";
import { validateSubset } from "@/core/frontend/subset/validator";
import { type RealRun, runReal } from "../../scripts/conformance/run-real.mts";
import { checkPinnedRuntime, readTarget } from "../../scripts/conformance/target.mts";
import { DifferentialMismatch, differentialProperty } from "./differential";
import { createsTimerInsideTimer, minimizeProgram, programArbitrary, programModelArbitrary, renderProgram } from "./generator/programs";
import type { SimOutput, Simulator } from "./support/simulator";

const problems = checkPinnedRuntime({ node: process.versions.node, v8: process.versions.v8 }, readTarget());
const pinned = problems.length === 0;
if (!pinned) console.warn(`Skipping real-node differential tests: ${problems.join("; ")} (docs/TARGET.md)`);

/** The real Node itself: a simulator that cannot disagree with the oracle. */
const oracle: Simulator = {
  run(source, lang): SimOutput {
    const real = runReal(source, { lang });
    return { ...real, warnings: [] };
  },
};

describe("programArbitrary (no real node)", () => {
  const samples = fc.sample(programArbitrary, { numRuns: 200, seed: 20261005 });

  it("every generated program is inside the subset and needs no type stripping", () => {
    for (const source of samples) {
      const parsed = parseScript(source);
      if (!parsed.ok) throw new Error(`does not parse: ${JSON.stringify(parsed.error)}\n${source}`);
      expect(validateSubset(parsed.value, analyzeScopes(parsed.value)), source).toEqual([]);
      const stripped = stripTypes(source);
      expect(stripped.ok && stripped.value, source).toBe(source);
    }
  });

  it("is varied: it produces every kind of scheduling construct", () => {
    const all = samples.join("\n");
    for (const marker of ["process.nextTick", "queueMicrotask", "Promise.resolve", "Promise.reject", "async function", "await ", "setTimeout", ".finally("]) {
      expect(all, marker).toContain(marker);
    }
  });

  it("stays small, so a failure is readable", () => {
    expect(Math.max(...samples.map((s) => s.length))).toBeLessThan(3000);
  });

  it("never schedules a timer from inside a timer callback", () => {
    fc.assert(fc.property(programModelArbitrary, (program) => !createsTimerInsideTimer(program)), { numRuns: 500, seed: 3 });
  });

  it("the detector itself sees a nested timer", () => {
    const nested = [{ kind: "timeout", delay: 1, body: [{ kind: "nextTick", body: [{ kind: "timeout", delay: 2, body: [] }] }] }] as const;
    expect(createsTimerInsideTimer(nested)).toBe(true);
    expect(createsTimerInsideTimer([{ kind: "nextTick", body: [{ kind: "timeout", delay: 2, body: [] }] }])).toBe(false);
  });
});

// Each run spawns node twice at most; a slow machine needs minutes, not the default 5 s.
const SLOW = 180_000;

describe("minimizeProgram (no real node)", () => {
  it("drops everything that is not needed to keep the failure", () => {
    fc.assert(
      fc.property(programModelArbitrary, (program) => {
        const needs = (source: string) => source.includes("console.log");
        fc.pre(needs(renderProgram(program)));
        const small = renderProgram(minimizeProgram(program, needs));
        // A single statement that logs once is the smallest program with a console.log.
        expect(small.match(/console.log/g)?.length, small).toBe(1);
        expect(small.split("\n").length, small).toBeLessThan(12);
      }),
      { numRuns: 100, seed: 17 },
    );
  });
});

describe.skipIf(!pinned)("differentialProperty against real node", () => {
  it("generated programs run cleanly on real node: exit 0, empty stderr", () => {
    fc.assert(
      fc.property(programArbitrary, (source) => {
        const real = runReal(source, { lang: "js" });
        expect({ code: real.exitCode, stderr: real.stderr }, source).toEqual({ code: 0, stderr: "" });
      }),
      { numRuns: 15, seed: 7 },
    );
  }, SLOW);

  it("an oracle simulator that shells out to real node passes", () => {
    const stats = differentialProperty(oracle, { numRuns: 25, seed: 11 });
    expect(stats.runs).toBe(25);
    // A program on which real node disagrees with itself is discarded, not failed; it is rare.
    expect(stats.discarded).toBeLessThanOrEqual(2);
  }, SLOW);

  it("a wrong simulator (stdout lines reversed) fails with a shrunk counterexample under 200 characters", () => {
    const reversing: Simulator = {
      run(source, lang) {
        const real = oracle.run(source, lang);
        const lines = real.stdout.split("\n");
        lines.pop();
        return { ...real, stdout: lines.reverse().map((l) => `${l}\n`).join("") };
      },
    };
    let failure: unknown;
    try {
      // One re-run keeps the shrinking affordable; the 5x default is covered by the stubbed test below.
      differentialProperty(reversing, { numRuns: 50, seed: 5, stabilityReruns: 1 });
    } catch (e) {
      failure = e;
    }
    expect(failure).toBeInstanceOf(DifferentialMismatch);
    const mismatch = failure as DifferentialMismatch;
    expect(mismatch.source.length).toBeLessThan(200);
    expect(mismatch.message).toContain("stdout differs at line");
    expect(mismatch.message).toContain(mismatch.source);
  }, SLOW);
});

describe("differentialProperty with an unstable oracle (stubbed runReal)", () => {
  const constant: Simulator = { run: () => ({ stdout: "x\n", stderr: "", exitCode: 0, warnings: [] }) };

  it("discards a program whose real outcome changes between runs, instead of failing", () => {
    let calls = 0;
    const flaky = (): RealRun => ({ stdout: `${calls++}\n`, stderr: "", exitCode: 0 });
    const stats = differentialProperty(constant, { numRuns: 6, seed: 1, runReal: flaky });
    expect(stats.runs).toBe(6);
    expect(stats.discarded).toBe(6);
  });

  it("still fails when the real outcome is stable and differs from the simulator", () => {
    const stable = (): RealRun => ({ stdout: "y\n", stderr: "", exitCode: 0 });
    expect(() => differentialProperty(constant, { numRuns: 3, seed: 1, runReal: stable })).toThrow(DifferentialMismatch);
  });

  it("re-runs a mismatching program 5 times on real node before judging it", () => {
    let calls = 0;
    const stable = (): RealRun => {
      calls++;
      return { stdout: "y\n", stderr: "", exitCode: 0 };
    };
    expect(() => differentialProperty(constant, { numRuns: 1, seed: 1, runReal: stable })).toThrow(DifferentialMismatch);
    // 1 initial run + 5 stability re-runs for the first mismatch (shrinking adds more).
    expect(calls).toBeGreaterThanOrEqual(6);
  });

  it("passes without any re-run when the simulator agrees", () => {
    let calls = 0;
    const agree = (): RealRun => {
      calls++;
      return { stdout: "x\n", stderr: "", exitCode: 0 };
    };
    const stats = differentialProperty(constant, { numRuns: 4, seed: 1, runReal: agree });
    expect(stats).toEqual({ runs: 4, discarded: 0 });
    expect(calls).toBe(4);
  });

  it("honours CONFORMANCE_RUNS when numRuns is not given", () => {
    const previous = process.env["CONFORMANCE_RUNS"];
    process.env["CONFORMANCE_RUNS"] = "3";
    try {
      const agree = (): RealRun => ({ stdout: "x\n", stderr: "", exitCode: 0 });
      expect(differentialProperty(constant, { seed: 1, runReal: agree }).runs).toBe(3);
    } finally {
      if (previous === undefined) delete process.env["CONFORMANCE_RUNS"];
      else process.env["CONFORMANCE_RUNS"] = previous;
    }
  });

  it("defaults to 25 runs", () => {
    const previous = process.env["CONFORMANCE_RUNS"];
    delete process.env["CONFORMANCE_RUNS"];
    try {
      const agree = (): RealRun => ({ stdout: "x\n", stderr: "", exitCode: 0 });
      expect(differentialProperty(constant, { seed: 1, runReal: agree }).runs).toBe(25);
    } finally {
      if (previous !== undefined) process.env["CONFORMANCE_RUNS"] = previous;
    }
  });
});
