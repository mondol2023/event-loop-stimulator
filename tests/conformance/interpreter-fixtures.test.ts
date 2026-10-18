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

describe("per-iteration let bindings against recorded fixtures", () => {
  it("bc-loop-let", () => {
    const want = recorded("bc-loop-let");
    const run = runSource(source("bc-loop-let"));
    expect(run.completion.type).toBe(want.exitCode === 0 ? "normal" : "throw");
    expect(run.stdout).toBe(want.stdout);
    expect(run.stderr).toBe(want.stderr);
  });

  it("closure-in-loop-let compiles", () => {
    expect(compileOrThrow(source("closure-in-loop-let")).functions.length).toBeGreaterThan(1);
  });

  // closure-in-loop-let itself needs push and map (Task 14) and setTimeout (Task 15). Its loops, with
  // push and map spelled out, must print the arrays real Node printed for them.
  it("closure-in-loop-let's loops print the recorded arrays", () => {
    const program = `
      function append(list, value) { list[list.length] = value; }
      function callAll(list) { const out = []; for (let k = 0; k < list.length; k++) out[k] = list[k](); return out; }
      const withLet = [];
      for (let i = 0; i < 3; i++) { append(withLet, () => i); }
      console.log(callAll(withLet));
      const withVar = [];
      for (var v = 0; v < 3; v++) { append(withVar, () => v); }
      console.log(callAll(withVar));
      const mutated = [];
      for (let i = 0; i < 6; i++) { append(mutated, () => i); i++; }
      console.log(callAll(mutated));
      const fromUpdate = [];
      function record(read) { append(fromUpdate, read); return 1; }
      for (let i = 0; i < 3; i += record(() => i)) {}
      console.log(callAll(fromUpdate));
      const fromBody = [];
      for (let i = 0; i < 3; i++) { const squared = i * i; append(fromBody, () => squared + i); }
      console.log(callAll(fromBody));
      const fromWhile = [];
      let w = 0;
      while (w < 3) { let copy = w; append(fromWhile, () => copy); w++; }
      console.log(callAll(fromWhile));
    `;
    const want = `${recorded("closure-in-loop-let").stdout.split("\n").slice(0, 6).join("\n")}\n`;
    const run = runSource(program);
    expect(run.completion.type, run.stderr).toBe("normal");
    expect(run.stdout).toBe(want);
  });

  it("break, continue and return leave a per-iteration context", () => {
    const run = runSource(`
      const seen = [];
      function f() {
        for (let i = 0; i < 10; i++) {
          seen[seen.length] = () => i;
          if (i === 1) continue;
          if (i === 3) break;
        }
        for (const j = 7; ; ) { seen[seen.length] = () => j; return 'returned'; }
      }
      console.log(f(), seen.length, seen[0](), seen[1](), seen[3](), seen[4]());
    `);
    expect(run.completion.type, run.stderr).toBe("normal");
    expect(run.stdout).toBe("returned 5 0 1 3 7\n");
  });

  it.todo("closure-in-loop-let (push/map: Task 14; setTimeout: Task 15)");
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
