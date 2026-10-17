import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ConsoleMethod, type ConsoleStream, consoleMethod } from "@/core/runtime/builtins/console";
import { hole, inspectTestWorld, type InspectTestWorld } from "@/core/runtime/builtins/inspectTestWorld";
import type { JSValue } from "@/core/runtime/values/JSValue";

// util.inspect and console formatting against the recorded fixtures. Each test replays a
// fixture's console calls with the model values its program builds (the interpreter that builds
// them arrives later); the expected text is the recorded stdout and stderr, never retyped.

const FIXTURES = join(__dirname, "fixtures");

function recorded(fixture: string): { stdout: string; stderr: string } {
  const e = JSON.parse(readFileSync(join(FIXTURES, `${fixture}.expected.json`), "utf8")) as {
    outcomes: { stdout: string; stderr: string }[];
  };
  const first = e.outcomes[0];
  if (!first) throw new Error(`${fixture} has no recorded outcome`);
  return { stdout: first.stdout, stderr: first.stderr };
}

function replay(script: (w: InspectTestWorld, call: (method: ConsoleMethod, ...args: JSValue[]) => void) => void) {
  const w = inspectTestWorld();
  const out = { stdout: "", stderr: "" };
  const realm = { ...w.realm, host: { write: (stream: ConsoleStream, text: string) => (out[stream] += text) } };
  script(w, (method, ...args) => consoleMethod(realm, method, args));
  return out;
}

const range = (n: number, from = 0): number[] => Array.from({ length: n }, (_, i) => i + from);

describe("inspect against recorded fixtures", () => {
  it("inspect-nesting-and-wrapping", () => {
    const out = replay(({ object: o, array: a, fn }, call) => {
      const log = (...args: JSValue[]) => call("log", ...args);
      log(o({ a: o({ b: o({ c: o({ d: 1 }) }) }) }));
      log(o({ a: o({ b: o({ c: o() }) }) }));
      log(o({ a: o({ b: o({ c: a([]) }) }) }));
      log(a([a([a([a([1])])])]));
      log(a([a([a([a([])])])]));
      log(o({ list: a([1, a([2, a([3, a([4])])])]) }));
      log(o({ alpha: "aaaaaaaaaa", beta: "bbbbbbbbbb", gamma: "cccccccccc", delta: "dddddddddd" }));
      log(o({ alpha: "aaaaaaaaaa", beta: "bbbbbbbbbb", gamma: "cccccccccc", delta: "dddddddddd", epsilon: 1 }));
      log(a(["aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccc", "dddddddddddddddddddd"]));
      log(o({ outer: o({ inner: o({ alpha: "aaaaaaaaaa", beta: "bbbbbbbbbb", gamma: "cccccccccc", delta: "dddddd" }) }) }));
      log(a([1, 2, 3, 4, 5, 6]));
      log(a([1, 2, 3, 4, 5, 6, 7]));
      log(a([1, 22, 333, 4444, 55555, 666666, 7777777, 88888888]));
      log(a(["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "ggggggg"]));
      log(a([1.5, 2.25, 3.125, ...range(24, 4)]));
      log(a(range(101)));
      log(a(["plain", "it's", 'say "hi"', `it's "both"`, "back`tick", "new\nline", "tab\t", "back\\slash"]));
      log(o({ "needs-quotes": 1, valid_id: 2, 3: 3, "a b": 4, "": 5 }));
      const named = fn("named");
      const anonymous = fn("anonymous");
      log(o({ f: named, g: anonymous, h: fn("h"), n: null, u: undefined, t: true, big: 1e21, neg: -0 }));
      log(a([null, undefined, NaN, -0, "s"]), a([named, anonymous]));
      log(o(), a([]), a([a([])]), a([o()]), o({ a: o() }), o({ a: a([]) }));
      log("top-level strings print raw:", "it's", a(["it's"]));
      log("values", 1, "two", o({ three: 3 }), a([4]), null, undefined);
      log(o({ a: 1 }), "between", a([2]));
    });
    expect(out).toEqual(recorded("inspect-nesting-and-wrapping"));
  });

  it("array-holes-inspect", () => {
    const out = replay(({ array: a }, call) => {
      const log = (...args: JSValue[]) => call("log", ...args);
      log(a([hole, 1]));
      log(a([1, hole, 3]));
      log(a([hole, hole]));
      log(a([1, hole, hole, 4, hole]));
      log(a([undefined, hole, undefined]));
      log(a([hole, hole, hole, "x"]), 4);
      log(a(["w", hole, hole, "x"]));
      log(2, 2);
      log(a([1, 1]), a([hole, hole]));
      log(a(["0", "1"]), a([]), a(["0", "2"]));
      log(undefined, undefined, undefined);
      log(a([1, 2, 3]));
      log(a([hole, 2, 3]), 3);
    });
    expect(out).toEqual(recorded("array-holes-inspect"));
  });

  it("inspect-special-numbers-and-quotes", () => {
    const out = replay(({ object: o, array: a }, call) => {
      const log = (...args: JSValue[]) => call("log", ...args);
      log(-0);
      log(a([-0, 0, NaN, Infinity, -Infinity]));
      log(o({ a: -0, b: NaN, c: Infinity }));
      log(a(["it's", 'say "hi"', "both ' and \"", "back`tick'\""]));
      log(o({ "a-b": 1, valid_id: 2, 3: 4, "with space": 5, "": 6 }));
      log("top level string is not quoted");
      log(a(["nested string is quoted"]));
      log(a([undefined, null, true]));
    });
    expect(out).toEqual(recorded("inspect-special-numbers-and-quotes"));
  });

  it("inspect-circular-and-long-arrays", () => {
    const out = replay(({ object: o, array: a, set }, call) => {
      const log = (...args: JSValue[]) => call("log", ...args);
      const first = o({ name: "a" });
      set(first, "self", first);
      log(first);
      const b = o({ x: 1 });
      const c = o({ b });
      set(b, "c", c);
      log(b);
      log(a(range(27, 1)));
      log(a(range(120)));
    });
    expect(out).toEqual(recorded("inspect-circular-and-long-arrays"));
  });

  it("console-format-directives", () => {
    const out = replay((_, call) => {
      const log = (...args: JSValue[]) => call("log", ...args);
      log("%s is %d", "x", 1.5);
      log("%i and %f", 42.9, "3.5abc");
      log("%c styled", "color:red");
      log("100%", 5);
      log("%");
      log("a %% b");
      log("%s", "one", "two", 3);
      log("%s %s", "only one");
      log("%d", "abc");
      log("%s", null, undefined);
      log("%s", 12, true);
      log("%d", -0);
      log("no directives", 1, "two");
    });
    expect(out).toEqual(recorded("console-format-directives"));
  });

  it("console-error-warn", () => {
    const out = replay(({ object: o, array: a }, call) => {
      call("log", "to stdout", 1);
      call("error", "to stderr", 2);
      call("warn", "warn also goes to stderr", o({ w: true }));
      call("error", o({ nested: o({ deep: o({ deeper: o({ deepest: 1 }) }) }) }));
      call("warn", a([1, 2, 3]), "after", null);
      call("log", "stdout again", a([undefined, null]));
      call("error");
      call("warn", "");
      call("error", "multi\nline", "second argument");
      call("log");
      call("log", "");
      call("error", "last on stderr");
      call("log", "last on stdout");
    });
    expect(out).toEqual(recorded("console-error-warn"));
  });
});
