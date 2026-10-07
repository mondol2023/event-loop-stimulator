import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverFixtures } from "../../scripts/conformance/fixtures.mts";
import { pendingSimulatorTodos } from "./runner";
import { SIMULATOR } from "./support/simulator";

// Phase 3 replaces each `it.todo` below with a real comparison of
// `SIMULATOR.run(...)` against the recorded expectation (compareToExpectation)
// and removes the name from TODO_FIXTURES. Until then the guard test keeps the
// todos from being forgotten: it fails as soon as SIMULATOR is set.

const CONFORMANCE_ROOT = dirname(fileURLToPath(import.meta.url));

// Only `program` fixtures are compared by output; `internals` fixtures are
// V8-native probes that Phase 3 checks against its own Map/elements-kind model.
const TODO_FIXTURES = discoverFixtures(CONFORMANCE_ROOT)
  .filter((f) => f.kind === "program")
  .map((f) => f.name);

describe("simulator output equals real node", () => {
  for (const name of TODO_FIXTURES) it.todo(`simulator output equals real node: ${name}`);

  it("has at least one fixture to compare", () => {
    expect(TODO_FIXTURES.length).toBeGreaterThan(0);
  });

  it("no fixture is still a todo once a SIMULATOR is set", () => {
    const pending = pendingSimulatorTodos(SIMULATOR, TODO_FIXTURES);
    expect(pending, `SIMULATOR is set but these fixtures are still it.todo: ${pending.join(", ")}`).toEqual([]);
  });
});
