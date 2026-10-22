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

describe("String, Number and Boolean objects", () => {
  it("wrapper objects print, convert, compare and expose their primitive", () => {
    expect(
      stdoutOf(`const s = new String("ab");
const n = new Number(3);
const b = new Boolean(false);
console.log(s, n, b, new Number(-0), new String(""), [new String("a"), new Number(2)], { a: new Boolean(true) });
s.x = 1;
n.y = 2;
console.log(s, n, s.length, s[1], s[2], s.x);
console.log(typeof s, typeof n, typeof b, typeof Number(1), typeof String(1), typeof Boolean(1));
console.log(s + "c", n + 1, \`\${s}\`, b ? "truthy" : "falsy", n == 3, n === 3, new Number(NaN) == NaN, s == "ab", b == false);
console.log(Number(), Number(undefined), Number(null), Number("0x10"), Number(true), Number(new String("12")), Number(" 7 "), Number("1e3"));
console.log(Boolean(), Boolean(""), Boolean("0"), Boolean(new Boolean(false)), Boolean(NaN), Boolean(0), Boolean({}));
console.log(String(n), String(b), String(new String("q")), n.toString(), b.toString(), s.toString(), n.valueOf(), b.valueOf(), s.valueOf());
console.log((5).toString(), (2.5).toString(10), true.toString(), "str".toString(), (1).valueOf(), "s".valueOf(), false.valueOf());
console.log(Object.keys(s), Object.keys(n), Object.keys("xy"), Object.keys(5));
console.log(s.hasOwnProperty("0"), s.hasOwnProperty("length"), s.hasOwnProperty("2"), n.hasOwnProperty("length"));
s[0] = "z";
console.log(s[0], delete s[0], s.length);
function whoAmI() { return this; }
console.log(whoAmI.call(5), whoAmI.call("t"), whoAmI.call(true), whoAmI.call(new Number(1)) );
console.log(new Number(1) + new Number(2), new String("a") + new String("b"), new Boolean(true) + 1, new Number(5) * new Number(2), -new Number(5));
console.log({} + "", [1, 2] + "", String({}), String(new Boolean(true)), \`\${[]}\`);
`),
    ).toBe(`[String: 'ab'] [Number: 3] [Boolean: false] [Number: -0] [String: ''] [ [String: 'a'], [Number: 2] ] { a: [Boolean: true] }
[String: 'ab'] { x: 1 } [Number: 3] { y: 2 } 2 b undefined 1
object object object number string boolean
abc 4 ab truthy true false false true true
0 NaN 0 16 1 12 7 1000
false false true true false false true
3 false q 3 false ab 3 false ab
5 2.5 true str 1 s false
[ '0', '1', 'x' ] [ 'y' ] [ '0', '1' ] []
true true false false
a false 2
[Number: 5] [String: 't'] [Boolean: true] [Number: 1]
3 ab 2 10 -5
[object Object] 1,2 [object Object] true 
`);
  });

  it("a strict store to a primitive throws, a sloppy one is ignored", () => {
    expect(
      stdoutOf(`"use strict";
const t = (f) => { try { f(); console.log("no throw"); } catch (e) { console.log(e.message); } };
t(() => { "abc".toString = 1; });
t(() => { (1).valueOf = 1; });
t(() => { "abc"[5] = 1; });
t(() => { "abc"[1] = 1; });
t(() => { true.x = 1; });
t(() => { (1.5).x = 1; });
t(() => { const k = "kk"; "abc"[k] = 1; });
t(() => { const s = "a"; s.length = 1; });
t(() => { (-0).x = 1; });
t(() => { "a\\nb".x = 1; });
`),
    ).toBe(`Cannot create property 'toString' on string 'abc'
Cannot create property 'valueOf' on number '1'
Cannot create property '5' on string 'abc'
Cannot assign to read only property '1' of string 'abc'
Cannot create property 'x' on boolean 'true'
Cannot create property 'x' on number '1.5'
Cannot create property 'kk' on string 'abc'
Cannot assign to read only property 'length' of string 'a'
Cannot create property 'x' on number '0'
Cannot create property 'x' on string 'a
b'
`);
  });
});
