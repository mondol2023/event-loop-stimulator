import { describe, expect, it } from "vitest";
import { simulate } from "@/core/timeline/simulate";

// Each program was run on the pinned node 24.19.0 and the expected text is what it printed.

function stdoutOf(source: string): string {
  const r = simulate(source, "js", { record: false });
  expect(r.diagnostics).toEqual([]);
  expect(r.stop, r.stderr).toBeUndefined();
  expect(r.stderr).toBe("");
  return r.stdout;
}

describe("constructors and Function.prototype", () => {
  it("new, call, apply, bind, hasOwnProperty and toString behave as node does", () => {
    expect(
      stdoutOf(`function F(a) { this.a = a; }
const f = new F(3);
console.log(f, new F(1) !== new F(1));
function G() { return { r: 1 }; }
function H() { return 5; }
console.log(new G(), new H());
const arrow = () => 1;
const o = { m() {} };
const a = async function () {};
function attempt(f) {
  try { f(); console.log("ok"); } catch (e) { console.log(e.message); }
}
attempt(() => new arrow());
attempt(() => new o.m());
attempt(() => new a());
attempt(() => new (1)());
attempt(() => new (function () {}.bind())());
attempt(() => new Math.abs());
function B(x, y, z) { this.s = [this, x, y, z].length; }
const bound = B.bind(null, 1);
const bb = new bound(2, 3);
console.log(bb, bound.name, bound.length, bound);
console.log(String(F), String(arrow), String(o.m), String(a), String(Math.abs), String(bound), \`\${function () { return 1; }}\`);
function Sloppy() { return typeof this; }
console.log(Sloppy.call(1), Sloppy.call("s"), Sloppy.call(true), Sloppy.call(null), Sloppy.apply(undefined, []));
console.log(Sloppy.call(1) === "object", (function () { "use strict"; return typeof this; }).call(1));
function Args(a, b) { return a + "-" + b; }
console.log(Args.apply(null, [1, 2]), Args.apply(null, { length: 2, 0: "x", 1: "y" }), Args.call(null, 1, 2), Args.bind(null, 5)(6));
console.log(F.hasOwnProperty("name"), f.hasOwnProperty("a"), f.hasOwnProperty("get"), [1].hasOwnProperty("0"), [1].hasOwnProperty("length"), "ab".hasOwnProperty("1"), (5).hasOwnProperty("x"));
attempt(() => Args.apply(null, 1));
`),
    ).toBe(`F { a: 3 } true
{ r: 1 } H {}
arrow is not a constructor
o.m is not a constructor
a is not a constructor
1 is not a constructor
ok
Math.abs is not a constructor
B { s: 4 } bound B 2 [Function: bound B]
function F(a) { this.a = a; } () => 1 m() {} async function () {} function abs() { [native code] } function () { [native code] } function () { return 1; }
object object object object object
true number
1-2 x-y 1-2 5-6
true true false true true true false
CreateListFromArrayLike called on non-object
`);
  });

  it("a sloppy function's caller and arguments are own and null while it is not running", () => {
    expect(stdoutOf(`function f() {}
console.log(f.caller, f.hasOwnProperty("caller"), f.hasOwnProperty("arguments"), Math.max(1, 5, 3), Math.min());`)).toBe("null true true 5 Infinity\n");
  });
});

describe("inputs that would break the host stop instead", () => {
  const stopOf = (source: string) => simulate(source, "js", { record: false }).stop;
  const long = (doublings: number) => `let s = "ab"; for (let i = 0; i < ${doublings}; i++) s += s;`;

  it.each([
    // 2**20 characters: past the work budget, inside the strings budget.
    [`${long(19)} Object.keys(s);`, { kind: "limit", limit: "work" }],
    [`${long(20)} Object.keys(new String(s));`, { kind: "limit", limit: "work" }],
    [`const a = []; a.length = 900000; Math.max.apply(null, a);`, { kind: "unsupported", reason: "an argument list of more than 65535 values" }],
    [`${long(20)} const a = []; a.length = 100000; a.join(s);`, { kind: "unsupported", reason: "a string longer than V8's maximum length" }],
    // The strings budget stops a doubling loop long before V8's maximum length.
    [`${long(30)}`, { kind: "limit", limit: "strings" }],
    [`function g() { return g.caller; } g();`, { kind: "unsupported", reason: "caller of a running sloppy function" }],
  ])("%s", (source, stop) => {
    expect(stopOf(source)).toMatchObject(stop);
  });
});
