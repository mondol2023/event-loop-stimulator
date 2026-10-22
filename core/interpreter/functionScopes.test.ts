import { describe, expect, it } from "vitest";
import { runSource } from "./interpreterTestWorld";

// Behavior the function-scope work added to the interpreter. Each expected text is what the
// pinned Node prints for the same program.

function out(source: string): string {
  const run = runSource(source);
  if (run.completion.type === "throw") throw new Error(`threw: ${run.stderr}`);
  return run.stdout;
}

const SHOW = "function show(f) { try { console.log(f()); } catch (e) { console.log(e.name + ': ' + e.message); } }\n";
const RESTRICTED = "TypeError: 'caller', 'callee', and 'arguments' properties may not be accessed on strict mode functions or the arguments objects for calls to them";

describe("the arguments object", () => {
  it("holds every argument passed, formal or not", () => {
    expect(out(SHOW + "function f() { return arguments.length; } show(() => f(1, 2, 3)); show(() => f());")).toBe("3\n0\n");
    expect(out(SHOW + "function f(a = 0) { return arguments.length + ':' + arguments[1]; } show(() => f(undefined, 'x'));")).toBe("2:x\n");
  });

  it("is not aliased to the parameters of strict code", () => {
    expect(out(SHOW + "function f(a) { 'use strict'; a = 5; return arguments[0]; } show(() => f(1));")).toBe("1\n");
  });

  it("is an object with its own tag and the enumerable indices", () => {
    expect(out(SHOW + "function f() { return typeof arguments; } show(f);")).toBe("object\n");
    expect(out(SHOW + "function f() { return Object.keys(arguments).toString(); } show(() => f('a', 'b'));")).toBe("0,1\n");
    expect(out(SHOW + "function f() { return String(arguments); } show(f);")).toBe("[object Arguments]\n");
  });

  it("has callee in sloppy code and a throwing one in strict code", () => {
    expect(out(SHOW + "function f() { return arguments.callee === f; } show(f);")).toBe("true\n");
    expect(out(SHOW + "function f() { 'use strict'; return arguments.callee; } show(f);")).toBe(`${RESTRICTED}\n`);
  });

  it("is the variable of the same name when the function declares one, and an arrow reads its parent's", () => {
    expect(out(SHOW + "function f() { var arguments = 5; return arguments; } show(f);")).toBe("5\n");
    expect(out(SHOW + "function f() { return () => arguments[0]; } show(() => f('outer')());")).toBe("outer\n");
  });

  it("stops at inspect, which prints an Arguments object", () => {
    expect(() => out("function f() { console.log(arguments); } f();")).toThrow(/arguments object/);
  });
});

describe("caller and arguments of a function", () => {
  it("throw on a strict function, an arrow and a builtin (%Function.prototype% accessors)", () => {
    expect(out(SHOW + "var s = function () { 'use strict'; }; show(() => s.caller); show(() => { s.arguments = 1; }); show(() => (() => 1).caller);")).toBe(
      `${RESTRICTED}\n${RESTRICTED}\n${RESTRICTED}\n`,
    );
    expect(out(SHOW + "show(() => console.log.caller);")).toBe(`${RESTRICTED}\n`);
  });

  it("are null on a sloppy function, which refuses writes", () => {
    expect(out(SHOW + "function sl() {} sl.caller = 5; sl.arguments = 5; show(() => sl.caller); show(() => sl.arguments);")).toBe("null\nnull\n");
  });
});

describe("delete of a name", () => {
  it("is false for a declared variable, and deletes a global property", () => {
    expect(out(SHOW + "G = 1; show(() => delete G); show(() => typeof G); show(() => delete notDefinedAnywhere); show(() => { var l = 1; return delete l; });")).toBe(
      "true\nundefined\ntrue\nfalse\n",
    );
  });
});

describe("Annex B block functions", () => {
  it("are visible in the function once the declaration has run", () => {
    expect(out("function f() { var before = typeof g; { function g() { return 1; } } return before + ' ' + typeof g; } console.log(f());")).toBe("undefined function\n");
  });

  it("keep a parameter's value, and a block function sees a later let as uninitialized", () => {
    expect(out("function f(p) { { function p() {} } return p; } console.log(f(7));")).toBe("7\n");
    expect(out(SHOW + "{ function g() { return x + 1; } show(() => g()); const x = 1; }")).toBe("ReferenceError: Cannot access 'x' before initialization\n");
  });
});

describe("parameter expressions and the body's var block", () => {
  it("evaluate in a scope the body's vars do not shadow", () => {
    const source = "var x = 'outside'; var inParams, inBody; function f(_ = inParams = function () { return x; }) { var x = 'inside'; inBody = function () { return x; }; } f(); console.log(inParams(), inBody());";
    expect(out(source)).toBe("outside inside\n");
  });

  it("start a body var named like a parameter with the parameter's value", () => {
    expect(out("function f(a, b = 1) { var a; var b; return a + ':' + b; } console.log(f(5), f(5, 6));")).toBe("5:1 5:6\n");
  });

  it("run inside an async function's try, so a throwing default rejects the promise", () => {
    const run = runSource("async function f(x = (() => { throw new Error('boom'); })()) {} f().catch((e) => console.log(e.message));");
    expect(run.stdout).toBe("boom\n");
  });
});
