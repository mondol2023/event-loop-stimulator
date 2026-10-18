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
