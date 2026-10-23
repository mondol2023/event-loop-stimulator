import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TieringModel } from "@/core/interpreter/tiering/TieringModel";
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
});
