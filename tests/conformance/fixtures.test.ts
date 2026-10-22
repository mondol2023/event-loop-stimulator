import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseExpectation } from "../../scripts/conformance/expectation.mts";
import { discoverFixtures, expectationFile } from "../../scripts/conformance/fixtures.mts";
import { compareToExpectation, pendingSimulatorTodos } from "./runner";
import { SIMULATOR } from "./support/simulator";

// Every `program` fixture runs end to end through the simulator and is compared with what real
// node recorded (refused fixtures by Decision D1). `internals` fixtures are V8-native probes;
// internals.test.ts compiles them in natives mode.

const CONFORMANCE_ROOT = dirname(fileURLToPath(import.meta.url));

const PROGRAM_FIXTURES = discoverFixtures(CONFORMANCE_ROOT).filter((f) => f.kind === "program");

describe("simulator output equals real node", () => {
  for (const fixture of PROGRAM_FIXTURES) {
    it(fixture.name, () => {
      const expectation = parseExpectation(JSON.parse(readFileSync(join(CONFORMANCE_ROOT, expectationFile(fixture)), "utf8")));
      const comparison = compareToExpectation(SIMULATOR.run(fixture.source, fixture.lang), expectation, fixture.meta);
      expect(comparison.ok, comparison.ok ? "" : comparison.diff).toBe(true);
    });
  }

  it("has at least one fixture to compare", () => {
    expect(PROGRAM_FIXTURES.length).toBeGreaterThan(0);
  });

  it("no fixture is still a todo once a SIMULATOR is set", () => {
    const pending = pendingSimulatorTodos(SIMULATOR, []);
    expect(pending, `SIMULATOR is set but these fixtures are still it.todo: ${pending.join(", ")}`).toEqual([]);
  });
});
