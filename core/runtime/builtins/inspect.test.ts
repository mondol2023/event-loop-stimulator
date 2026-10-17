import { describe, expect, it } from "vitest";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import type { CallSite } from "../stack";
import { consoleMethod, type ConsoleStream } from "./console";
import { formatWithOptions } from "./formatWithOptions";
import { inspect } from "./inspect";
import { hole, inspectTestWorld } from "./inspectTestWorld";

// The expected strings were probed on the pinned Node 24.19.0 with util.inspect; the fixture
// lines are judged by tests/conformance/inspect-fixtures.test.ts and the random data values by
// tests/conformance/inspect-oracle.test.ts.

const frame = (functionName: string | null, line: number, column: number): CallSite => ({
  functionName,
  typeName: null,
  methodName: null,
  isTopLevel: true,
  isAsync: false,
  pos: { line, column },
});
const topLevel = (line: number, column: number): CallSite => ({
  functionName: null,
  typeName: "Object",
  methodName: null,
  isTopLevel: false,
  isAsync: false,
  pos: { line, column },
});

function halted(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    if (e instanceof SimulationHalt && e.stop.kind === "unsupported") return e.stop.reason;
    throw e;
  }
  throw new Error("expected an unsupported stop");
}

describe("inspect: primitives", () => {
  const { realm } = inspectTestWorld();

  it("formats numbers with -0, strings quoted, and the other primitives", () => {
    expect(inspect(realm, -0)).toBe("-0");
    expect(inspect(realm, 1e21)).toBe("1e+21");
    expect(inspect(realm, NaN)).toBe("NaN");
    expect(inspect(realm, undefined)).toBe("undefined");
    expect(inspect(realm, null)).toBe("null");
    expect(inspect(realm, true)).toBe("true");
    expect(inspect(realm, "plain")).toBe("'plain'");
  });

  it("chooses the quote and escapes like strEscape", () => {
    expect(inspect(realm, "it's")).toBe(`"it's"`);
    expect(inspect(realm, `it's "both"`)).toBe("`it's \"both\"`");
    expect(inspect(realm, "back`tick'\"")).toBe(`'back\`tick\\'"'`);
    expect(inspect(realm, "it's \"${x}\"")).toBe(`'it\\'s "\${x}"'`);
    expect(inspect(realm, "a\nb\t\x00\x7f\x9f\\")).toBe("'a\\nb\\t\\x00\\x7F\\x9F\\\\'");
    expect(inspect(realm, "\ud83d")).toBe("'\\ud83d'");
    expect(inspect(realm, "😀")).toBe("'😀'");
  });
});

describe("inspect: objects and arrays", () => {
  it("prints functions by kind and name", () => {
    const w = inspectTestWorld();
    expect(inspect(w.realm, w.fn("f"))).toBe("[Function: f]");
    expect(inspect(w.realm, w.fn("af", "async"))).toBe("[AsyncFunction: af]");
    expect(inspect(w.realm, w.fn(""))).toBe("[Function (anonymous)]");
    expect(inspect(w.realm, w.fn("g", "generator"))).toBe("[GeneratorFunction: g]");
    expect(inspect(w.realm, w.fn("ag", "asyncGenerator"))).toBe("[AsyncGeneratorFunction: ag]");
    const withProps = w.fn("fp");
    w.set(withProps, "x", 1);
    expect(inspect(w.realm, withProps)).toBe("[Function: fp] { x: 1 }");
  });

  it("prefixes the constructor name, or the null prototype", () => {
    const w = inspectTestWorld();
    expect(inspect(w.realm, w.object({}, null))).toBe("[Object: null prototype] {}");
    expect(inspect(w.realm, w.object({ a: 1 }, null))).toBe("[Object: null prototype] { a: 1 }");
    expect(inspect(w.realm, w.instanceOf("Foo", { a: 1 }))).toBe("Foo { a: 1 }");
    expect(inspect(w.realm, w.instanceOf("Bar"))).toBe("Bar {}");
    expect(inspect(w.realm, w.intrinsics.math)).toBe("Object [Math] {}");
    expect(inspect(w.realm, w.intrinsics.arrayPrototype)).toBe("Object(0) []");
    expect(inspect(w.realm, w.intrinsics.objectPrototype)).toBe("[Object: null prototype] {}");
  });

  it("prints non-index array keys after the elements", () => {
    const w = inspectTestWorld();
    const a = w.array([1, 2]);
    w.set(a, "k", 3);
    expect(inspect(w.realm, a)).toBe("[ 1, 2, k: 3 ]");
  });

  it("stops at the depth", () => {
    const w = inspectTestWorld();
    expect(inspect(w.realm, w.object({ a: w.object({ b: 1 }) }), { depth: 0 })).toBe("{ a: [Object] }");
    expect(inspect(w.realm, w.array([w.array([1])]), { depth: 0 })).toBe("[ [Array] ]");
  });

  it("splits a long string value at its newlines", () => {
    const w = inspectTestWorld();
    const s = `${"x".repeat(70)}\nyy${"z".repeat(20)}`;
    expect(inspect(w.realm, w.object({ s }))).toBe(
      `{\n  s: '${"x".repeat(70)}\\n' +\n    'yy${"z".repeat(20)}'\n}`,
    );
  });

  it("groups arrays with Latin-1 text by display width", () => {
    const w = inspectTestWorld();
    expect(inspect(w.realm, w.array(["é", "ñ", "ü", "a", "b", "c", "d"]))).toBe(
      "[\n  'é', 'ñ', 'ü',\n  'a', 'b', 'c',\n  'd'\n]",
    );
  });

  it("stops rather than guess the ICU width of wide text in a grouped array", () => {
    const w = inspectTestWorld();
    expect(halted(() => inspect(w.realm, w.array(["中", "b", "c", "d", "e", "f", "g"])))).toMatch(/width/);
  });

  it("prints holes and circular references", () => {
    const w = inspectTestWorld();
    expect(inspect(w.realm, w.array([hole, 1]))).toBe("[ <1 empty item>, 1 ]");
    const a = w.object({ name: "a" });
    w.set(a, "self", a);
    expect(inspect(w.realm, a)).toBe("<ref *1> { name: 'a', self: [Circular *1] }");
  });
});

describe("inspect: errors", () => {
  it("prints the stack, indented when nested", () => {
    const w = inspectTestWorld();
    const e = w.error("Error", "boom", [frame("f", 1, 1), topLevel(2, 3)]);
    const stack = "Error: boom\n    at f (main.cjs:1:1)\n    at Object.<anonymous> (main.cjs:2:3)";
    expect(inspect(w.realm, e)).toBe(stack);
    expect(inspect(w.realm, w.object({ e }))).toBe(
      "{\n  e: Error: boom\n      at f (main.cjs:1:1)\n      at Object.<anonymous> (main.cjs:2:3)\n}",
    );
    expect(inspect(w.realm, w.array([e]))).toBe(
      "[\n  Error: boom\n      at f (main.cjs:1:1)\n      at Object.<anonymous> (main.cjs:2:3)\n]",
    );
  });

  it("appends enumerable own properties", () => {
    const w = inspectTestWorld();
    const e = w.error("TypeError", "bad", [frame(null, 1, 1)]);
    w.set(e, "code", "X");
    expect(inspect(w.realm, e)).toBe("TypeError: bad\n    at main.cjs:1:1 {\n  code: 'X'\n}");
    expect(inspect(w.realm, w.object({ e2: e }))).toBe(
      "{\n  e2: TypeError: bad\n      at main.cjs:1:1 {\n    code: 'X'\n  }\n}",
    );
  });

  it("brackets an error without frames", () => {
    const w = inspectTestWorld();
    expect(inspect(w.realm, w.error("Error", "no frames"))).toBe("[Error: no frames]");
  });

  it("prints an AggregateError's errors", () => {
    const w = inspectTestWorld();
    const inner = w.error("Error", "a", [frame(null, 2, 2)]);
    const agg = w.error("AggregateError", "All promises were rejected", [frame(null, 1, 1)]);
    w.defineHidden(agg, "errors", w.array([inner]));
    expect(inspect(w.realm, agg)).toBe(
      "AggregateError: All promises were rejected\n    at main.cjs:1:1 {\n  [errors]: [\n    Error: a\n        at main.cjs:2:2\n  ]\n}",
    );
  });
});

describe("inspect: promises", () => {
  it("prints the state and the result", () => {
    const w = inspectTestWorld();
    expect(inspect(w.realm, w.promise({ state: "fulfilled", result: 1 }))).toBe("Promise { 1 }");
    expect(inspect(w.realm, w.promise({ state: "pending" }))).toBe("Promise { <pending> }");
    expect(inspect(w.realm, w.promise({ state: "rejected", result: 3 }))).toBe("Promise { <rejected> 3 }");
    const deep = w.object({ a: w.object({ b: w.object({ c: w.object() }) }) });
    expect(inspect(w.realm, w.promise({ state: "fulfilled", result: deep }))).toBe("Promise { { a: { b: [Object] } } }");
  });
});

describe("formatWithOptions", () => {
  it("formats %s with a builtin toString through inspect at depth 0", () => {
    const w = inspectTestWorld();
    expect(formatWithOptions(w.realm, ["%s!", w.object({ a: w.object({ b: 1 }) })])).toBe("{ a: [Object] }!");
    expect(formatWithOptions(w.realm, ["%s", w.array([1, w.array([2])])])).toBe("[ 1, [Array] ]");
  });

  it("stops on %j, %o and %O when they consume an argument", () => {
    const w = inspectTestWorld();
    for (const directive of ["%j", "%o", "%O"]) {
      expect(halted(() => formatWithOptions(w.realm, [directive, 1]))).toContain(directive);
      expect(formatWithOptions(w.realm, [`${directive} %s`])).toBe(`${directive} %s`);
    }
  });

  it("stops rather than call a user toString or valueOf", () => {
    const w = inspectTestWorld();
    const custom = w.object({ toString: w.fn("toString") });
    expect(halted(() => formatWithOptions(w.realm, ["%s", custom]))).toMatch(/toString/);
    expect(halted(() => formatWithOptions(w.realm, ["%d", w.object()]))).toMatch(/%d/);
  });
});

describe("console", () => {
  it("writes the formatted line to the method's stream", () => {
    const w = inspectTestWorld();
    const written: [ConsoleStream, string][] = [];
    const realm = { ...w.realm, host: { write: (stream: ConsoleStream, text: string) => written.push([stream, text]) } };
    consoleMethod(realm, "log", ["to stdout", 1]);
    consoleMethod(realm, "error", ["to stderr", w.object({ w: true })]);
    consoleMethod(realm, "warn", []);
    expect(written).toEqual([
      ["stdout", "to stdout 1\n"],
      ["stderr", "to stderr { w: true }\n"],
      ["stderr", "\n"],
    ]);
  });
});
