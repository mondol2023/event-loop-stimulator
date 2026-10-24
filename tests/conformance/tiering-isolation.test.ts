import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TieringModel } from "@/core/interpreter/tiering/TieringModel";
import { LIMITS } from "@/core/timeline/limits";
import { simulate } from "@/core/timeline/simulate";
import type { Tick } from "@/core/timeline/Tick";
import { parseExpectation } from "../../scripts/conformance/expectation.mts";
import { discoverFixtures, expectationFile } from "../../scripts/conformance/fixtures.mts";
import { compareToExpectation } from "./runner";
import { simulatorRun } from "./support/simulator";

// D5: the TieringModel only observes. Every program fixture runs with a model attached; the output
// must equal what real node recorded and what the same run gives with no model.

const CONFORMANCE_ROOT = dirname(fileURLToPath(import.meta.url));

const PROGRAM_FIXTURES = discoverFixtures(CONFORMANCE_ROOT).filter((f) => f.kind === "program");

describe("the tiering model never changes a run", () => {
  for (const fixture of PROGRAM_FIXTURES) {
    it(fixture.name, () => {
      const expectation = parseExpectation(JSON.parse(readFileSync(join(CONFORMANCE_ROOT, expectationFile(fixture)), "utf8")));
      const model = new TieringModel();
      const withModel = simulatorRun(fixture, { tiering: model });
      const comparison = compareToExpectation(withModel, expectation, fixture.meta);
      expect(comparison.ok, comparison.ok ? "" : comparison.diff).toBe(true);
      expect(withModel).toEqual(simulatorRun(fixture));
    });
  }

  it("sees functions and tier changes in a recursive fixture, so the hooks ran", () => {
    const fixture = PROGRAM_FIXTURES.find((f) => f.name === "recursion-factorial");
    if (!fixture) throw new Error("the recursion-factorial fixture is gone");
    const model = new TieringModel();
    simulatorRun(fixture, { tiering: model });
    expect(Object.keys(model.tiers().byFunction).length).toBeGreaterThan(0);
    expect(model.drainEvents().length).toBeGreaterThan(0);
  });

  // The recorded path: the TickRecorder reads the model (drains its events onto ticks), so it is checked apart from the unrecorded runs above.
  describe("recording ticks with a model attached", () => {
    const HOT = `
      function f(o) { return o.x + 1; }
      var o = { x: 1 };
      for (var k = 0; k < 600; k++) f(o);
      f({ y: 0, x: 2 });
      console.log(f(o));
    `;
    const withoutTiering = (ticks: readonly Tick[]) =>
      ticks.map((t) => {
        const v8 = { ...t.v8 };
        delete v8.tiers;
        delete v8.tierEvents;
        return { ...t, narration: undefined, v8 };
      });

    for (const [name, source] of [["a hot function with a deopt", HOT]] as const) {
      it(`gives the same Exact output and ticks as a run without a model: ${name}`, () => {
        const plain = simulate(source, "js", { record: true });
        const model = new TieringModel();
        const tiered = simulate(source, "js", { record: true, tiering: model });
        expect(tiered.stdout).toBe(plain.stdout);
        expect(tiered.stderr).toBe(plain.stderr);
        expect(tiered.exitCode).toBe(plain.exitCode);
        expect(tiered.stop).toEqual(plain.stop);
        expect(tiered.warnings).toEqual(plain.warnings);
        expect(tiered.tickCount).toBe(plain.tickCount);
        expect(tiered.ticks.length).toBe(plain.ticks.length);
        expect(withoutTiering(tiered.ticks)).toEqual(withoutTiering(plain.ticks));
        // The tick budget (D4) is not spent by the model.
        expect(tiered.tickCount).toBeLessThanOrEqual(LIMITS.ticks);
      }, 60_000);

      it(`carries v8.tiers on every tick and v8.tierEvents where the model changed a tier: ${name}`, () => {
        const plain = simulate(source, "js", { record: true });
        const tiered = simulate(source, "js", { record: true, tiering: new TieringModel() });
        expect(plain.ticks.every((t) => t.v8.tiers === undefined && t.v8.tierEvents === undefined)).toBe(true);
        expect(tiered.ticks.length).toBeGreaterThan(0);
        expect(tiered.ticks.every((t) => t.v8.tiers !== undefined)).toBe(true);
        const events = tiered.ticks.flatMap((t) => t.v8.tierEvents ?? []);
        expect(events.some((e) => e.kind === "tier-up")).toBe(true);
        expect(events.some((e) => e.kind === "deopt")).toBe(true);
        expect(events.every((e) => e.truth === "modeled")).toBe(true);
      });
    }

    it("keeps every program fixture within the tick budget with a model attached", () => {
      for (const fixture of PROGRAM_FIXTURES.filter((f) => f.meta.expect !== "refused")) {
        const r = simulate(fixture.source, fixture.lang, { record: false, tiering: new TieringModel() });
        expect(r.stop?.kind === "limit" && r.stop.limit === "ticks", fixture.name).toBe(false);
        expect(r.tickCount, fixture.name).toBeLessThanOrEqual(LIMITS.ticks);
      }
    });
  });
});
