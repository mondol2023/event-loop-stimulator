import { describe, expect, it } from "vitest";
import { simulate } from "@/core/timeline/simulate";

// String(), the Array constructor and the toString builtins OrdinaryToPrimitive reaches
// (Object.prototype.toString / valueOf, Array.prototype.toString, Error.prototype.toString).
// Every expected line was printed by the pinned node 24.19.0.

function run(source: string) {
  const r = simulate(source, "js", { record: false });
  expect(r.diagnostics).toEqual([]);
  return r;
}

function stdoutOf(source: string): string {
  const r = run(source);
  expect(r.stop, r.stderr).toBeUndefined();
  expect(r.stderr).toBe("");
  return r.stdout;
}

describe("String, Array and the toString builtins", () => {
  it("String() is ToString, and objects convert through Object/Array/Error.prototype.toString", () => {
    expect(
      stdoutOf(
        'function g() { return this + "|"; }\n' +
          'console.log(g(), String(1), String(), String(null), String({}), String([1, [2, 3]]), String(new Error("m")), String(new TypeError()), `${{}}`, typeof String);',
      ),
    ).toBe("[object global]| 1  null [object Object] 1,2,3 Error: m TypeError [object Object] function\n");
  });

  it("Array(...) and new Array(...) follow the Array constructor, and the tag names Promise", () => {
    expect(
      stdoutOf('console.log(String, Array, new Array(3), Array(1, 2), new Array("3"), Array(), [1, 2] + "", ({}) + 1, Promise.resolve() + "");'),
    ).toBe("[Function: String] [Function: Array] [ <3 empty items> ] [ 1, 2 ] [ '3' ] [] 1,2 [object Object]1 [object Promise]\n");
  });

  it("an invalid length is a RangeError", () => {
    expect(
      stdoutOf(
        'try { new Array(-1); } catch (e) { console.log(e.name + ": " + e.message); }\ntry { Array(1.5); } catch (e) { console.log(e.name + ": " + e.message); }',
      ),
    ).toBe("RangeError: Invalid array length\nRangeError: Invalid array length\n");
  });

  it("Array.prototype.toString joins with commas, empty for null, undefined, holes and a cycle", () => {
    expect(stdoutOf('const a = [1]; a.push(a); console.log(a + "", String([null, undefined, , 2.5, -0, "s"]), [[], [[]]] + "!");')).toBe("1, ,,,2.5,0,s ,!\n");
  });

  it("Error.prototype.toString reads name and message when it runs", () => {
    expect(stdoutOf('const e = new Error("x"); e.name = "Custom"; console.log(e + "");')).toBe("Custom: x\n");
  });

  it("converting a function to a string stops: its source text is not modeled", () => {
    expect(run('console.log(String(function f() {}));').stop?.kind).toBe("unsupported");
  });

  it("new String(...) stops: wrapper objects are not modeled", () => {
    expect(run('const s = new String("a");').stop?.kind).toBe("unsupported");
  });
});
