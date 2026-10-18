import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseExpectation } from "../../scripts/conformance/expectation.mts";
import { discoverFixtures, expectationFile } from "../../scripts/conformance/fixtures.mts";
import { compareToExpectation, pendingSimulatorTodos } from "./runner";
import { SIMULATOR, simulatorRun } from "./support/simulator";

// Phase 3 replaces each `it.todo` below with a real comparison of the simulator's
// output against the recorded expectation (compareToExpectation) and removes the
// name from TODO_FIXTURES. Until then the guard test keeps the todos from being
// forgotten: it fails as soon as SIMULATOR is set (Task 22).

const CONFORMANCE_ROOT = dirname(fileURLToPath(import.meta.url));

// Only `program` fixtures are compared by output; `internals` fixtures are
// V8-native probes that Phase 3 checks against its own Map/elements-kind model.
const PROGRAM_FIXTURES = discoverFixtures(CONFORMANCE_ROOT).filter((f) => f.kind === "program");

// Programs that schedule nothing (no promises, timers, ticks or async functions) and use
// only what the interpreter models so far. They run end to end through `simulate`.
const SYNC_FIXTURES = new Set([
  "array-holes-inspect",
  "array-length-truncate",
  "array-methods",
  "bc-method-calls",
  "builtin-callback-throws",
  "default-params",
  "error-stack-property",
  "inspect-circular-and-long-arrays",
  "inspect-nesting-and-wrapping",
  "number-to-string",
  "object-key-order",
  "bc-array-literals",
  "bc-block-contexts",
  "bc-block-exit",
  "bc-break-continue",
  "bc-closures",
  "bc-const-assign",
  "bc-defaults",
  "bc-far-jumps",
  "bc-functions",
  "bc-if-else",
  "bc-locals-operators",
  "bc-logical-globals",
  "bc-loop-let",
  "bc-loop-merge",
  "bc-loops",
  "bc-named-expression",
  "bc-object-literals",
  "bc-optional",
  "bc-properties",
  "bc-sibling-blocks",
  "bc-tdz",
  "bc-tdz-assign",
  "bc-tdz-flow",
  "bc-this",
  "bc-this-strict",
  "bc-try-catch",
  "bc-try-finally",
  "closure-counter",
  "console-error-warn",
  "console-format-directives",
  "const-assign-error",
  "empty-script",
  "inspect-special-numbers-and-quotes",
  "let-tdz-uncaught",
  "loose-equality-coercions",
  "recursion-factorial",
  "strict-mode-this",
  "strings-and-templates",
  "throw-in-finally-overrides",
  "throw-non-error",
  "top-level-this-and-params",
  "try-catch-finally-order",
  "ts-enum-refused",
  "ts-namespace-refused",
  "ts-param-props-refused",
  "ts-strip-basic",
  "uncaught-deep-recursion-frames",
  "uncaught-in-method",
  "uncaught-reference-error",
  "uncaught-type-error",
  "var-hoisting",
]);

// Programs whose only scheduling is promise jobs and queueMicrotask, drained once after the
// script (Task 15's minimal host), and async functions on top of them (Task 16). Task 17 adds
// nextTick and timers.
const MICROTASK_FIXTURES = new Set(["await-thenable-two-extra-ticks", "bc-async", "promise-resolve-same-promise", "return-vs-return-await"]);

// Synchronous too, but each still needs something later tasks own: the String global,
// Object.prototype.toString, the CallPrinter TypeError text.
// They stay todos with the async fixtures until then.
const TODO_FIXTURES = PROGRAM_FIXTURES.filter((f) => !SYNC_FIXTURES.has(f.name) && !MICROTASK_FIXTURES.has(f.name)).map((f) => f.name);

describe("synchronous programs equal real node end to end", () => {
  for (const fixture of PROGRAM_FIXTURES.filter((f) => SYNC_FIXTURES.has(f.name) || MICROTASK_FIXTURES.has(f.name))) {
    it(fixture.name, () => {
      const expectation = parseExpectation(JSON.parse(readFileSync(join(CONFORMANCE_ROOT, expectationFile(fixture)), "utf8")));
      const comparison = compareToExpectation(simulatorRun(fixture), expectation, fixture.meta);
      expect(comparison.ok, comparison.ok ? "" : comparison.diff).toBe(true);
    });
  }

  it("every SYNC_FIXTURES name is a program fixture", () => {
    const names = new Set(PROGRAM_FIXTURES.map((f) => f.name));
    expect([...SYNC_FIXTURES].filter((n) => !names.has(n))).toEqual([]);
  });
});

describe("simulator output equals real node", () => {
  for (const name of TODO_FIXTURES) it.todo(`simulator output equals real node: ${name}`);

  it("has at least one fixture to compare", () => {
    expect(PROGRAM_FIXTURES.length).toBeGreaterThan(0);
  });

  it("no fixture is still a todo once a SIMULATOR is set", () => {
    const pending = pendingSimulatorTodos(SIMULATOR, TODO_FIXTURES);
    expect(pending, `SIMULATOR is set but these fixtures are still it.todo: ${pending.join(", ")}`).toEqual([]);
  });
});
