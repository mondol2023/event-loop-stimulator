import { describe, expect, it } from "vitest";
import { type Expectation, parseExpectation } from "../../scripts/conformance/expectation.mts";
import { readTarget } from "../../scripts/conformance/target.mts";
import { compareToExpectation, pendingSimulatorTodos } from "./runner";
import type { SimOutput } from "./support/simulator";

// Pure comparison logic: fake simulators only, no real node.

const target = readTarget();

function expectation(
  outcomes: Expectation["outcomes"],
  nondeterministic = false,
): Expectation {
  return parseExpectation({
    schema: 1,
    fixture: "demo",
    kind: "program",
    lang: "js",
    target,
    nondeterministic,
    outcomes,
  });
}

const sim = (o: Partial<SimOutput> = {}): SimOutput => ({
  stdout: "a\nb\n",
  stderr: "",
  exitCode: 0,
  warnings: [],
  ...o,
});

const det = expectation([{ stdout: "a\nb\n", stderr: "", exitCode: 0 }]);

describe("compareToExpectation (deterministic)", () => {
  it("passes on a byte-for-byte match", () => {
    expect(compareToExpectation(sim(), det)).toEqual({ ok: true });
  });

  it("ignores warnings when the fixture is deterministic", () => {
    expect(compareToExpectation(sim({ warnings: ["anything"] }), det)).toEqual({ ok: true });
  });

  it("fails on a one-byte stdout difference and names line and column", () => {
    const r = compareToExpectation(sim({ stdout: "a\nbX\n" }), det);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diff).toContain("stdout");
      expect(r.diff).toContain("line 2, column 1");
    }
  });

  it("locates a difference on the first line", () => {
    const r = compareToExpectation(sim({ stdout: "ab\nb\n" }), det);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diff).toContain("line 1, column 1");
  });

  it("reports a truncated stream at the position where the shorter one ends", () => {
    const r = compareToExpectation(sim({ stdout: "a\n" }), det);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diff).toContain("line 2, column 0");
  });

  it("fails on a stderr difference and names the stream", () => {
    const r = compareToExpectation(sim({ stderr: "boom\n" }), det);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diff).toContain("stderr");
  });

  it("fails on the wrong exit code and shows both codes", () => {
    const r = compareToExpectation(sim({ exitCode: 1 }), det);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diff).toContain("exit code");
      expect(r.diff).toContain("expected 0");
      expect(r.diff).toContain("got 1");
    }
  });

  it("does not treat CRLF as LF (byte-equal means byte-equal)", () => {
    expect(compareToExpectation(sim({ stdout: "a\r\nb\r\n" }), det).ok).toBe(false);
  });

  it("reports every differing stream", () => {
    const r = compareToExpectation(sim({ stdout: "x", stderr: "y", exitCode: 2 }), det);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diff).toContain("stdout");
      expect(r.diff).toContain("stderr");
      expect(r.diff).toContain("exit code");
    }
  });
});

describe("compareToExpectation (nondeterministic)", () => {
  const nd = expectation(
    [
      { stdout: "immediate\ntimeout\n", stderr: "", exitCode: 0 },
      { stdout: "timeout\nimmediate\n", stderr: "", exitCode: 0 },
    ],
    true,
  );
  const warn = ["ordering is not guaranteed by Node"];

  it("passes with either recorded outcome when the warning is present", () => {
    expect(compareToExpectation(sim({ stdout: "immediate\ntimeout\n", warnings: warn }), nd)).toEqual({ ok: true });
    expect(compareToExpectation(sim({ stdout: "timeout\nimmediate\n", warnings: warn }), nd)).toEqual({ ok: true });
  });

  it("fails without the fidelity warning even if the output is recorded", () => {
    const r = compareToExpectation(sim({ stdout: "immediate\ntimeout\n" }), nd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diff).toContain("not guaranteed");
  });

  it("fails when the warning does not say 'not guaranteed'", () => {
    const r = compareToExpectation(sim({ stdout: "immediate\ntimeout\n", warnings: ["heads up"] }), nd);
    expect(r.ok).toBe(false);
  });

  it("fails when the output is not one of the recorded outcomes", () => {
    const r = compareToExpectation(sim({ stdout: "timeout\n", warnings: warn }), nd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diff).toContain("none of the 2 recorded outcomes");
  });

  it("requires stdout, stderr and exit code to match the SAME outcome", () => {
    const mixed = expectation(
      [
        { stdout: "a", stderr: "", exitCode: 0 },
        { stdout: "b", stderr: "e", exitCode: 1 },
      ],
      true,
    );
    expect(compareToExpectation(sim({ stdout: "a", stderr: "e", exitCode: 1, warnings: warn }), mixed).ok).toBe(false);
  });
});

describe("compareToExpectation (simulation stops)", () => {
  it("fails a run that stopped even when its output matches", () => {
    const r = compareToExpectation(sim({ stop: { kind: "limit", detail: "ticks" } }), det);
    expect(r).toEqual({
      ok: false,
      diff: "simulation stopped (limit: ticks); real node ran to completion",
    });
  });

  it("names an unsupported stop's reason", () => {
    const r = compareToExpectation(sim({ stop: { kind: "unsupported", detail: "%j directive" } }), det);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diff).toBe("simulation stopped (unsupported: %j directive); real node ran to completion");
  });

  it("fails a stopped nondeterministic run too", () => {
    const nd = expectation(
      [
        { stdout: "a\nb\n", stderr: "", exitCode: 0 },
        { stdout: "b\na\n", stderr: "", exitCode: 0 },
      ],
      true,
    );
    const r = compareToExpectation(
      sim({ stop: { kind: "limit", detail: "work" }, warnings: ["ordering is not guaranteed by Node"] }),
      nd,
      {},
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diff).toContain("simulation stopped");
  });
});

describe("compareToExpectation (refused fixtures, D1)", () => {
  const refusedMeta = { expect: "refused", diagnostic: "E_TS_UNSUPPORTED" } as const;
  const refused = expectation([
    { stdout: "", stderr: "main.cjs:2\n  > enum Color {\n\nSyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]\n", exitCode: 1 },
  ]);
  const refusal = (o: Partial<SimOutput> = {}) =>
    sim({ stdout: "", stderr: "E_TS_UNSUPPORTED: TypeScript enum is not supported in strip-only mode\n", exitCode: 1, ...o });

  it("passes when real node failed and we refuse with exit 1 and the declared code", () => {
    expect(compareToExpectation(refusal(), refused, refusedMeta)).toEqual({ ok: true });
  });

  it("does not compare stderr bytes against node's loader output", () => {
    const r = compareToExpectation(refusal({ stderr: "E_TS_UNSUPPORTED: any message at all\n" }), refused, refusedMeta);
    expect(r).toEqual({ ok: true });
  });

  it("fails when we exit 0", () => {
    const r = compareToExpectation(refusal({ exitCode: 0 }), refused, refusedMeta);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diff).toContain("exit code");
  });

  it("fails on a different diagnostic code", () => {
    const r = compareToExpectation(refusal({ stderr: "E_SYNTAX: nope\n" }), refused, refusedMeta);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diff).toContain("E_SYNTAX");
      expect(r.diff).toContain("E_TS_UNSUPPORTED");
    }
  });

  it("fails when stderr is not `<code>: <message>` lines", () => {
    expect(compareToExpectation(refusal({ stderr: "SyntaxError: x\n" }), refused, refusedMeta).ok).toBe(false);
    expect(compareToExpectation(refusal({ stderr: "" }), refused, refusedMeta).ok).toBe(false);
  });

  it("fails when real node did not exit non-zero (the fixture is not a refusal)", () => {
    const ran = expectation([{ stdout: "1\n", stderr: "", exitCode: 0 }]);
    const r = compareToExpectation(refusal(), ran, refusedMeta);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diff).toContain("real node");
  });

  it("fails a refused run that also stopped", () => {
    const r = compareToExpectation(refusal({ stop: { kind: "limit", detail: "ticks" } }), refused, refusedMeta);
    expect(r.ok).toBe(false);
  });

  it("without meta, a fixture is compared byte for byte as before", () => {
    expect(compareToExpectation(refusal(), refused).ok).toBe(false);
  });
});

describe("pendingSimulatorTodos", () => {
  it("is empty while no simulator is set (todos are allowed)", () => {
    expect(pendingSimulatorTodos(undefined, ["a", "b"])).toEqual([]);
  });

  it("lists every fixture still todo once a simulator is set", () => {
    const simulator = { run: () => sim() };
    expect(pendingSimulatorTodos(simulator, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("is empty once a simulator is set and nothing is todo", () => {
    const simulator = { run: () => sim() };
    expect(pendingSimulatorTodos(simulator, [])).toEqual([]);
  });
});
