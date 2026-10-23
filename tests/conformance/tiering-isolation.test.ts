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
  let observed = 0;
  let tierEvents = 0;

  for (const fixture of PROGRAM_FIXTURES) {
    it(fixture.name, () => {
      const expectation = parseExpectation(JSON.parse(readFileSync(join(CONFORMANCE_ROOT, expectationFile(fixture)), "utf8")));
      const model = new TieringModel();
      const withModel = simulatorRun(fixture, { tiering: model });
      const comparison = compareToExpectation(withModel, expectation, fixture.meta);
      expect(comparison.ok, comparison.ok ? "" : comparison.diff).toBe(true);
      expect(withModel).toEqual(simulatorRun(fixture));
      observed += Object.keys(model.tiers().byFunction).length;
      tierEvents += model.drainEvents().length;
    });
  }

  it("observed functions and tier changes in the fixtures, so the hooks ran", () => {
    expect(PROGRAM_FIXTURES.length).toBeGreaterThan(0);
    expect(observed).toBeGreaterThan(0);
    expect(tierEvents).toBeGreaterThan(0);
  });
});
