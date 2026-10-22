import { describe, expect, it } from "vitest";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { runSource } from "@/core/interpreter/interpreterTestWorld";

function out(source: string): string {
  const run = runSource(source);
  if (run.completion.type === "throw") throw new Error(`threw: ${run.stderr}`);
  return run.stdout;
}

describe("Array.prototype", () => {
  it("push appends and returns the new length; pop removes and returns the last element", () => {
    expect(out("const a = [1]; console.log(a.push(2, 3), a, a.pop(), a, [].pop());")).toBe("3 [ 1, 2 ] 3 [ 1, 2 ] undefined\n");
  });

  it("map, filter, forEach and reduce pass (element, index, array) and skip holes", () => {
    expect(out("const h = [1, , 3]; console.log(h.map((x) => x * 2), h.filter(() => true), h.reduce((a, b) => a + b));")).toBe(
      "[ 2, <1 empty item>, 6 ] [ 1, 3 ] 4\n",
    );
    expect(out("console.log([5, 6].reduce((acc, x, i, all) => acc + x * i + all.length, 0));")).toBe("10\n");
  });

  it("reduce on an empty array throws a TypeError unless an initial value is given", () => {
    expect(out("try { [].reduce((a, b) => a); } catch (e) { console.log(e.name, e.message); } console.log([].reduce((a, b) => a, undefined));")).toBe(
      "TypeError Reduce of empty array with no initial value\nundefined\n",
    );
  });

  it("a non-callable callback throws with the typeof-prefixed message", () => {
    const src = (v: string) => `try { [1].map(${v}); } catch (e) { console.log(e.message); }`;
    expect(out(src("1"))).toBe("number 1 is not a function\n");
    expect(out(src("undefined"))).toBe("undefined is not a function\n");
    expect(out(src("null"))).toBe("object null is not a function\n");
    expect(out(src("'a'"))).toBe('string "a" is not a function\n');
    expect(out(src("true"))).toBe("boolean true is not a function\n");
    expect(out(src("{}"))).toBe("object is not a function\n");
  });

  it("an exception thrown in a callback unwinds through the builtin; the builtin shows as a frame", () => {
    const stack = out("function f() { throw new Error('x'); } try { [1].map(f); } catch (e) { console.log(e.stack); }");
    expect(stack.split("\n").slice(0, 4)).toEqual(["Error: x", "    at f (main.cjs:1:22)", "    at Array.map (<anonymous>)", "    at Object.<anonymous> (main.cjs:1:50)"]);
  });

  it("the length is read once: elements pushed during forEach are not visited", () => {
    expect(out("const g = [1, 2]; let n = 0; g.forEach(() => { n++; g.push(0); }); console.log(n, g.length);")).toBe("2 4\n");
  });

  it("sort calls the comparison function in TimSort's order (binary insertion for short arrays)", () => {
    const source = "const log = []; [5, 1, 4, 2, 3, 9, 7, 8, 6, 0].sort(function (x, y) { log.push(x + ':' + y); return x - y; }); console.log(log.toString());";
    expect(out(source)).toBe("1:5,4:1,4:5,4:1,2:4,2:1,3:4,3:2,9:3,9:5,7:4,7:9,7:5,8:4,8:7,8:9,6:5,6:8,6:7,0:5,0:3,0:2,0:1\n");
  });

  it("sort puts undefined last and drops holes to the end; the default order compares strings", () => {
    expect(out("const b = [3, , undefined, 1, , 2]; b.sort(); console.log(b, b.length);")).toBe("[ 1, 2, 3, undefined, <2 empty items> ] 6\n");
    expect(out("console.log([10, 9, 1, 100].sort(), ['b', undefined, 'a'].sort(), [2, 1].sort(function () { return NaN; }));")).toBe("[ 1, 10, 100, 9 ] [ 'a', 'b', undefined ] [ 2, 1 ]\n");
  });

  it("sort refuses a comparison function that is not one, and unwinds a throwing one", () => {
    expect(out("try { [1].sort(1); } catch (e) { console.log(e.message); }")).toBe("The comparison function must be either a function or undefined: 1\n");
    expect(out("try { [2, 1].sort(function () { throw new Error('x'); }); } catch (e) { console.log(e.message); }")).toBe("x\n");
  });

  it("sort stops for 64 elements or more, where TimSort starts merging runs", () => {
    expect(() => runSource("Array(64).sort();")).not.toThrow();
    const attempt = () => runSource("const a = []; for (let i = 0; i < 64; i++) a.push(63 - i); a.sort();");
    expect(attempt).toThrow(SimulationHalt);
  });

  it("concat spreads array arguments, keeps holes and adds other values as elements", () => {
    expect(out("console.log([1].concat(2, [3, [4]]), [1, 2, , 3].concat([, 5]), [].concat().length);")).toBe(
      "[ 1, 2, 3, [ 4 ] ] [ 1, 2, <1 empty item>, 3, <1 empty item>, 5 ] 0\n",
    );
  });

  it("stops with the work limit instead of spinning over a huge holey array", () => {
    const attempt = () => runSource("const a = []; a.length = 4294967295; a.forEach(() => {});");
    expect(attempt).toThrow(SimulationHalt);
    try {
      attempt();
    } catch (e) {
      expect((e as SimulationHalt).stop).toEqual({ kind: "limit", limit: "work" });
    }
  });
});
