import { describe, expect, it } from "vitest";
import {
  buildExpectation,
  parseExpectation,
  serializeExpectation,
  type RealFunctionBytecode,
} from "../../scripts/conformance/expectation.mts";
import type { Fixture } from "../../scripts/conformance/fixtures.mts";
import type { RealRun, RealRunOptions } from "../../scripts/conformance/run-real.mts";

const target = { node: "24.19.0", v8: "13.6.233.17-node.51" };

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    name: "a",
    lang: "js",
    kind: "program",
    file: "fixtures/a.cjs",
    source: "console.log(1)",
    meta: {},
    ...overrides,
  };
}

const ok = (stdout: string): RealRun => ({ stdout, stderr: "", exitCode: 0 });

describe("buildExpectation", () => {
  it("runs a deterministic fixture once and records the single outcome", () => {
    const calls: RealRunOptions[] = [];
    const e = buildExpectation(fixture(), target, (_src, opts) => {
      calls.push(opts);
      return ok("1\n");
    });
    expect(calls).toEqual([{ lang: "js" }]);
    expect(e).toEqual({
      schema: 1,
      fixture: "a",
      kind: "program",
      lang: "js",
      target,
      nondeterministic: false,
      outcomes: [{ stdout: "1\n", stderr: "", exitCode: 0 }],
    });
  });

  it("passes nodeArgs through", () => {
    let seen: RealRunOptions | undefined;
    buildExpectation(fixture({ meta: { nodeArgs: ["--expose-gc"] } }), target, (_s, o) => {
      seen = o;
      return ok("");
    });
    expect(seen).toEqual({ lang: "js", nodeArgs: ["--expose-gc"] });
  });

  it("runs a nondeterministic fixture 25 times by default and stores each distinct outcome, sorted", () => {
    let n = 0;
    const outputs = ["b\n", "a\n", "b\n", "c\n"];
    const e = buildExpectation(fixture({ meta: { nondeterministic: true } }), target, () => ok(outputs[n++ % 4] as string));
    expect(n).toBe(25);
    expect(e.nondeterministic).toBe(true);
    expect(e.outcomes.map((o) => o.stdout)).toEqual(["a\n", "b\n", "c\n"]);
  });

  it("honours meta.runs", () => {
    let n = 0;
    buildExpectation(fixture({ meta: { nondeterministic: true, runs: 4 } }), target, () => {
      n++;
      return ok("x");
    });
    expect(n).toBe(4);
  });

  it("lets a RealRunError propagate", () => {
    expect(() =>
      buildExpectation(fixture(), target, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
  });

  it("does not capture bytecode when no hook is wired (Task 4 seam)", () => {
    expect("bytecode" in buildExpectation(fixture(), target, () => ok("1\n"))).toBe(false);
  });

  describe("captureBytecode seam", () => {
    const bc: RealFunctionBytecode = {
      name: "main",
      header: { length: 1, parameterCount: 1, registerCount: 0, frameSize: 0 },
      instructions: [{ offset: 0, text: "Return" }],
      constantPool: [],
      handlerTable: [],
      children: {},
    };

    it("captures for a program that exits 0", () => {
      const e = buildExpectation(fixture(), target, () => ok("1\n"), () => bc);
      expect(e.bytecode).toEqual(bc);
    });

    it("skips a program that exits non-zero unless meta.expect is run", () => {
      const fail: RealRun = { stdout: "", stderr: "x", exitCode: 1 };
      expect("bytecode" in buildExpectation(fixture(), target, () => fail, () => bc)).toBe(false);
      const e = buildExpectation(fixture({ meta: { expect: "run" } }), target, () => fail, () => bc);
      expect(e.bytecode).toEqual(bc);
    });

    it("hands the hook the recorded outcomes, so it can reject a diverging capture run", () => {
      const fail: RealRun = { stdout: "", stderr: "x", exitCode: 1 };
      let seen: unknown;
      buildExpectation(fixture({ meta: { expect: "run" } }), target, () => fail, (_f, outcomes) => {
        seen = outcomes;
        return bc;
      });
      expect(seen).toEqual([{ stdout: "", stderr: "x", exitCode: 1 }]);
    });

    it("lets a capture failure propagate instead of dropping the bytecode", () => {
      const failing = () => {
        throw new Error("capture failed");
      };
      expect(() => buildExpectation(fixture(), target, () => ok("1\n"), failing)).toThrow("capture failed");
    });

    it("never captures for internals fixtures", () => {
      const e = buildExpectation(fixture({ kind: "internals" }), target, () => ok(""), () => bc);
      expect("bytecode" in e).toBe(false);
    });
  });
});

describe("serializeExpectation", () => {
  it("writes 2-space JSON with a trailing newline", () => {
    const e = buildExpectation(fixture(), target, () => ok("1\n"));
    const text = serializeExpectation(e);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "schema": 1,');
    expect(parseExpectation(JSON.parse(text))).toEqual(e);
  });
});

describe("bytecode schema", () => {
  it("accepts nested children and rejects unknown keys inside them", () => {
    const child = {
      name: "f",
      header: { length: 2, parameterCount: 1, registerCount: 0, frameSize: 0 },
      instructions: [{ offset: 0, position: { at: 3, kind: "S" }, text: "Jump (@4)" }],
      constantPool: ["<SharedFunctionInfo f>"],
      handlerTable: [],
      children: {},
    };
    const root = { ...child, name: "main", children: { "0": child } };
    const base = {
      schema: 1,
      fixture: "a",
      kind: "program",
      lang: "js",
      target,
      nondeterministic: false,
      outcomes: [{ stdout: "", stderr: "", exitCode: 0 }],
    };
    expect(parseExpectation({ ...base, bytecode: root }).bytecode?.children["0"]?.name).toBe("f");
    expect(() => parseExpectation({ ...base, bytecode: { ...root, children: { "0": { ...child, x: 1 } } } })).toThrow();
  });
});
