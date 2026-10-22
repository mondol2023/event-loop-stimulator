import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverFixtures } from "../../scripts/conformance/fixtures.mts";
import { simulate } from "@/core/timeline/simulate";

// The timeline is a read-only view of the run (the exactness firewall): recording ticks and
// narration must never change what the program prints, and the same input must give the same
// timeline.

const ROOT = dirname(fileURLToPath(import.meta.url));
const RUNNABLE = discoverFixtures(ROOT).filter((f) => f.kind === "program" && f.meta.expect !== "refused");

const DETERMINISM_SAMPLE = [
  "nexttick-vs-promise",
  "promise-vs-timeout",
  "async-await-order",
  "bc-closures",
  "object-key-order",
  "array-methods",
  "interval-clear",
  "uncaught-in-microtask",
  "unhandled-rejection",
  "timer-in-timer-ordering",
];

describe("the timeline of the program fixtures", () => {
  it.each(DETERMINISM_SAMPLE)("%s: two runs give toStrictEqual timelines", (name) => {
    const fixture = RUNNABLE.find((f) => f.name === name);
    expect(fixture, name).toBeDefined();
    if (!fixture) return;
    const first = simulate(fixture.source, fixture.lang);
    const second = simulate(fixture.source, fixture.lang);
    expect(first.ticks.length).toBeGreaterThan(0);
    expect(first.ticks).toStrictEqual(second.ticks);
  });

  it(`recording on or off gives identical stdout, stderr, exit code and warnings (${RUNNABLE.length} fixtures)`, () => {
    for (const fixture of RUNNABLE) {
      const on = simulate(fixture.source, fixture.lang, { record: true });
      const off = simulate(fixture.source, fixture.lang, { record: false });
      const pick = (r: typeof on) => ({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, warnings: r.warnings, stop: r.stop, tickCount: r.tickCount });
      expect(pick(on), fixture.name).toStrictEqual(pick(off));
      expect(on.ticks.length, fixture.name).toBe(on.tickCount);
    }
  });

  it("nexttick-vs-promise: Node's process.nextTick is narrated before V8's PromiseReactionJob", () => {
    const fixture = RUNNABLE.find((f) => f.name === "nexttick-vs-promise");
    if (!fixture) throw new Error("fixture missing");
    const starts = simulate(fixture.source, fixture.lang).ticks.filter((t) => t.phase === "nextTick" || t.phase === "microtask");
    const jobStarts = starts.filter((t) => /^(Node|V8) /.test(t.narration));
    const firstTick = jobStarts.findIndex((t) => t.narration.includes("process.nextTick"));
    const firstJob = jobStarts.findIndex((t) => t.narration.includes("PromiseReactionJob"));
    expect(firstTick).toBeGreaterThanOrEqual(0);
    expect(firstJob).toBeGreaterThan(firstTick);
    expect(jobStarts.filter((t) => t.phase === "nextTick").every((t) => t.narration.startsWith("Node"))).toBe(true);
    expect(jobStarts.filter((t) => t.phase === "microtask").every((t) => t.narration.startsWith("V8"))).toBe(true);
  });
});
