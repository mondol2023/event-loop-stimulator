import { describe, expect, it } from "vitest";
import { type FixtureOutcome, measure, problemsFor, ratchetFixtures, readStatusFile } from "./support/bytecodeStatus";

// The bytecode fidelity ratchet (PROMPT.md §3.4). For every program fixture with recorded bytecode,
// our generator's output is compared with V8's, function by function, and the result must equal
// what `bytecode-status.json` records: not worse (a regression) and not better (an improvement
// nobody wrote down). Update the record with `npm run conformance:status`, then explain every
// exception it lists; the expectations themselves (`*.expected.json`) are never touched.

const status = readStatusFile();
const fixtures = ratchetFixtures();

describe("bytecode fidelity ratchet", () => {
  it.each(fixtures.map(({ fixture }) => fixture.name))("%s matches its recorded status", (name) => {
    const found = fixtures.find(({ fixture }) => fixture.name === name);
    if (!found) throw new Error(`no fixture ${name}`);
    const outcome = measure(found.fixture, found.real);
    expect(problemsFor(outcome, status[name])).toEqual([]);
  });

  it("records nothing for a fixture that no longer exists", () => {
    const known = new Set(fixtures.map(({ fixture }) => fixture.name));
    expect(Object.keys(status).filter((name) => !known.has(name))).toEqual([]);
  });
});

describe("problemsFor", () => {
  const real = { name: "", header: { length: 2, parameterCount: 6, registerCount: 0, frameSize: 0 }, instructions: [], constantPool: [], handlerTable: [], children: {} };
  const outcome = (functions: FixtureOutcome["functions"], refusal?: string): FixtureOutcome => ({
    fixture: "demo",
    real,
    functions,
    ...(refusal === undefined ? {} : { refusal }),
  });

  it("accepts a pending fixture the generator still cannot compile", () => {
    expect(problemsFor(outcome([], "VariableDeclaration is not compiled to bytecode yet"), { status: "pending" })).toEqual([]);
  });

  it("flags an improvement that was not recorded", () => {
    const exact = outcome([{ path: "<root>", level: "exact", diffs: [] }]);
    expect(problemsFor(exact, { status: "pending" })).toEqual(["demo: bytecode fidelity improved: recorded pending, now exact"]);
  });

  it("flags a regression", () => {
    const worse = outcome([{ path: "<root>", level: "none", diffs: ["offset 0: ours `Return`, V8 `Ldar a0`"] }]);
    expect(problemsFor(worse, { status: "exact" })).toEqual(["demo: bytecode fidelity regressed: recorded exact, now pending"]);
  });

  it("demands a real reason for every exception", () => {
    const operands = outcome([{ path: "<root>", level: "opcodes", diffs: ["offset 2: ours `A [1]`, V8 `A [2]`"] }]);
    const reasons = ["", "TODO: explain this difference"];
    for (const reason of reasons) {
      const entry = { status: "opcodes" as const, exceptions: [{ function: "<root>", level: "operands" as const, reason }] };
      expect(problemsFor(operands, entry)).toEqual(["demo: <root> has no real reason for its operands exception"]);
    }
    const documented = { status: "opcodes" as const, exceptions: [{ function: "<root>", level: "operands" as const, reason: "V8 numbers its feedback slots differently here" }] };
    expect(problemsFor(operands, documented)).toEqual([]);
  });

  it("accepts a documented opcodes exception", () => {
    const differs = outcome([{ path: "<root>", level: "none", diffs: ["offset 4: ours `Jump [3]`, V8 `JumpConstant [0]`"] }]);
    const entry = { status: "opcodes" as const, exceptions: [{ function: "<root>", level: "opcodes" as const, reason: "V8 jumps through the constant pool here" }] };
    expect(problemsFor(differs, entry)).toEqual([]);
  });

  it("flags an exception that no longer applies", () => {
    const exact = outcome([{ path: "<root>", level: "exact", diffs: [] }]);
    const entry = { status: "opcodes" as const, exceptions: [{ function: "<root>", level: "operands" as const, reason: "stale" }] };
    expect(problemsFor(exact, entry).some((p) => p.includes("no longer differs"))).toBe(true);
  });

  it("flags a fixture missing from the record", () => {
    expect(problemsFor(outcome([]), undefined)).toEqual(["demo: not in bytecode-status.json (run npm run conformance:status)"]);
  });
});
