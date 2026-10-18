import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UNREACHABLE_OPCODES } from "@/core/interpreter/IgnitionInterpreter";
import { compileOrThrow, runSource } from "@/core/interpreter/interpreterTestWorld";

// The interpreter against the recorded fixtures: a program's stdout, stderr and exit status
// are what real Node printed, never retyped. Only fixtures the interpreter can run so far are
// replayed; the list grows with each task that adds opcodes.

const FIXTURES = join(__dirname, "fixtures");

function recorded(fixture: string): { stdout: string; stderr: string; exitCode: number } {
  const e = JSON.parse(readFileSync(join(FIXTURES, `${fixture}.expected.json`), "utf8")) as {
    outcomes: { stdout: string; stderr: string; exitCode: number }[];
  };
  const first = e.outcomes[0];
  if (!first) throw new Error(`${fixture} has no recorded outcome`);
  return first;
}

const source = (fixture: string): string => readFileSync(join(FIXTURES, `${fixture}.cjs`), "utf8");

describe("straight-line interpreter against recorded fixtures", () => {
  for (const fixture of ["bc-locals-operators", "bc-if-else", "bc-loops", "bc-logical-globals"]) {
    it(fixture, () => {
      const want = recorded(fixture);
      const run = runSource(source(fixture));
      expect(run.completion.type).toBe(want.exitCode === 0 ? "normal" : "throw");
      expect(run.stdout).toBe(want.stdout);
      expect(run.stderr).toBe(want.stderr);
    });
  }
});

describe("calls, closures, contexts and TDZ against recorded fixtures", () => {
  for (const fixture of ["recursion-factorial", "bc-closures", "bc-tdz", "bc-tdz-assign", "bc-tdz-flow", "bc-const-assign"]) {
    it(fixture, () => {
      const want = recorded(fixture);
      const run = runSource(source(fixture));
      expect(run.completion.type).toBe(want.exitCode === 0 ? "normal" : "throw");
      expect(run.stdout).toBe(want.stdout);
      expect(run.stderr).toBe(want.stderr);
    });
  }

  // Replayed once the opcodes they also need exist: try/catch (Task 11) and Array.prototype.push (Task 14).
  it.todo("default-params (needs Task 14 push)");
});

describe("properties, literals and optional chaining against recorded fixtures", () => {
  for (const fixture of [
    "bc-properties",
    "bc-object-literals",
    "bc-array-literals",
    "bc-optional",
    "strings-and-templates",
    "closure-counter",
    "top-level-this-and-params",
  ]) {
    it(fixture, () => {
      const want = recorded(fixture);
      const run = runSource(source(fixture));
      expect(run.completion.type).toBe(want.exitCode === 0 ? "normal" : "throw");
      expect(run.stdout).toBe(want.stdout);
      expect(run.stderr).toBe(want.stderr);
    });
  }

  // Each of these also needs something from a later task.
  it.todo("object-key-order (Object.keys and reduce: Task 14)");
  it.todo("object-delete-and-methods (try/catch: Task 11; Object.keys and push: Task 14)");
  it.todo("logical-nullish-optional (try/catch: Task 11, and the CallPrinter text of `x is not a function`)");
});

describe("exceptions, handler tables and finally against recorded fixtures", () => {
  for (const fixture of [
    "bc-try-catch",
    "bc-try-finally",
    "try-catch-finally-order",
    "throw-in-finally-overrides",
    "const-assign-error",
    "strict-mode-this",
  ]) {
    it(fixture, () => {
      const want = recorded(fixture);
      const run = runSource(source(fixture));
      expect(run.completion.type).toBe(want.exitCode === 0 ? "normal" : "throw");
      expect(run.stdout).toBe(want.stdout);
      expect(run.stderr).toBe(want.stderr);
    });
  }

  // map, forEach and reduce arrive with Task 14; core/interpreter/exceptions.test.ts covers the unwinding with a stub builtin.
  it.todo("builtin-callback-throws (Array.prototype.map/forEach/reduce: Task 14)");
});

describe("never-emitted opcodes", () => {
  it("no fixture the generator compiles contains one", () => {
    const never = new Set<string>(UNREACHABLE_OPCODES);
    const found: string[] = [];
    for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".cjs"))) {
      let program;
      try {
        program = compileOrThrow(readFileSync(join(FIXTURES, file), "utf8"));
      } catch {
        continue; // not in the compiled subset yet
      }
      for (const fn of program.functions) for (const i of fn.array.instructions) if (never.has(i.opcode)) found.push(`${file}:${i.opcode}`);
    }
    expect(found).toEqual([]);
  });
});
