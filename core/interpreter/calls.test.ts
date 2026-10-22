import { describe, expect, it } from "vitest";
import type { Instruction } from "@/core/bytecode/BytecodeArray";
import { local } from "@/core/bytecode/bytecodes";
import { Context } from "@/core/runtime/objects/Context";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSObject } from "@/core/runtime/objects/JSObject";
import { OrdinaryDefineOwnProperty, OrdinaryGet } from "@/core/runtime/spec/objectOps";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { SimulationHalt, type SimulationStop } from "@/core/shared/simulationHalt";
import { normal } from "./Completion";
import { contextHandler } from "./dispatch/contexts";
import { Frame } from "./Frame";
import { compileOrThrow, runSource } from "./interpreterTestWorld";
import { IgnitionInterpreter } from "./IgnitionInterpreter";
import { Realm } from "@/core/runtime/Realm";

function stdoutOf(source: string, setup?: (realm: Realm) => void): string {
  const run = runSource(source, setup);
  expect(run.completion.type, run.stderr).toBe("normal");
  return run.stdout;
}

/** `Name: message` of the error a program leaves uncaught. */
function uncaught(source: string): string {
  const { completion } = runSource(source);
  expect(completion.type).toBe("throw");
  const error = completion.value as JSObject;
  return `${String(OrdinaryGet(error, "name"))}: ${String(OrdinaryGet(error, "message"))}`;
}

function stopOf(source: string, setup?: (realm: Realm) => void): SimulationStop {
  try {
    runSource(source, setup);
  } catch (e) {
    expect(e).toBeInstanceOf(SimulationHalt);
    return (e as SimulationHalt).stop;
  }
  throw new Error("the run did not stop");
}

describe("closures and contexts", () => {
  it("gives each call of a factory its own scope, shared by the closures made in it", () => {
    expect(
      stdoutOf(`
        function makeCounter(start) { let count = start; return () => ++count; }
        const a = makeCounter(0), b = makeCounter(100);
        console.log(a(), a(), b(), a());
      `),
    ).toBe("1 2 101 3\n");
  });

  it("reads and writes a captured parameter through the function context", () => {
    expect(stdoutOf("function outer(x) { return () => { x = x + 1; return x; }; } const f = outer(5); console.log(f(), f());")).toBe("6 7\n");
  });

  it("walks the context chain by depth (LdaContextSlot)", () => {
    expect(
      stdoutOf(`
        function a() { var x = 1; function b() { var y = 2; function c() { return x + y; } return c(); } return b(); }
        console.log(a());
      `),
    ).toBe("3\n");
  });

  it("runs a block whose binding a closure captures in a block context of its own", () => {
    expect(stdoutOf("{ let n = 1; const inc = () => { n = n + 1; return n; }; console.log(inc(), inc(), n); }")).toBe("2 3 3\n");
  });

  it("sees an assignment made after the closure was created", () => {
    expect(stdoutOf("function late() { const read = () => value; var value = 'set later'; return read(); } console.log(late());")).toBe("set later\n");
  });

  it("recurses, mutually too", () => {
    expect(
      stdoutOf(`
        function isEven(n) { return n === 0 ? true : isOdd(n - 1); }
        function isOdd(n) { return n === 0 ? false : isEven(n - 1); }
        console.log(isEven(10), isOdd(7));
      `),
    ).toBe("true true\n");
  });

  it("shares one feedback cell per creation site and gives each site its own", () => {
    const probed: JSValue[] = [];
    const probe = (realm: Realm): void => {
      const fn = realm.nativeFunction("probe", 1, (_r, _t, args) => {
        probed.push(args[0]);
        return normal(undefined);
      });
      OrdinaryDefineOwnProperty(realm, realm.globalObject, "probe", { value: fn, writable: true, enumerable: false, configurable: true });
    };
    stdoutOf("function make() { return () => 1; } probe(make()); probe(make()); probe(() => 2);", probe);
    const [first, second, other] = probed as JSFunction[];
    expect(first).toBeInstanceOf(JSFunction);
    expect(first).not.toBe(second);
    expect(first?.feedbackCell).toBe(second?.feedbackCell);
    expect(other?.feedbackCell).not.toBe(first?.feedbackCell);
  });
});

describe("temporal dead zone and const", () => {
  it("throws kAccessedUninitializedVariable for a read before the let runs", () => {
    expect(uncaught("function early() { return later; } early(); let later = 1;")).toBe("ReferenceError: Cannot access 'later' before initialization");
  });

  it("throws for an uninitialized binding read in the same function", () => {
    expect(uncaught("function f() { const g = () => x; g(); let x = 1; } f();")).toBe("ReferenceError: Cannot access 'x' before initialization");
  });

  it("throws for an assignment to a captured let before its declaration", () => {
    expect(uncaught("function f() { w = 2; let w = 1; return () => w; } f();")).toBe("ReferenceError: Cannot access 'w' before initialization");
  });

  it("lets a later parameter default see an earlier one and trips on a later one", () => {
    expect(stdoutOf("function g(a, b = a + 1, c = 10) { return a + b + c; } console.log(g(1), g(1, 5), g(1, undefined, 0));")).toBe("13 16 3\n");
    expect(uncaught("function early(a = b, b = 1) { return a; } early();")).toBe("ReferenceError: Cannot access 'b' before initialization");
  });

  it("throws a TypeError for an assignment to a const (ThrowConstAssignError)", () => {
    expect(uncaught("function f() { const v = 1; v = 2; } f();")).toBe("TypeError: Assignment to constant variable.");
    expect(uncaught("const v = 1; const f = () => { v++; }; f();")).toBe("TypeError: Assignment to constant variable.");
  });
});

describe("receivers", () => {
  it("makes a sloppy function's this the global object and a strict one's undefined", () => {
    expect(stdoutOf("function s() { return typeof this; } console.log(s());")).toBe("object\n");
    expect(stdoutOf("'use strict'; function s() { return typeof this; } console.log(s());")).toBe("undefined\n");
  });

  it("calls the CommonJS wrapper with this === module.exports", () => {
    expect(stdoutOf("console.log(this === module.exports, this === exports, typeof require, typeof __filename);")).toBe("true true function string\n");
  });

  it("keeps this in an arrow from the enclosing function", () => {
    expect(stdoutOf("const arrow = () => this === module.exports; console.log(arrow());")).toBe("true\n");
  });
});

describe("Construct", () => {
  function installThing(realm: Realm, seen: JSValue[][]): void {
    const prototype = realm.newObject();
    const Thing = realm.nativeConstructor(
      "Thing",
      2,
      () => normal(undefined),
      (r, args) => {
        seen.push([...args]);
        return normal(r.newObject(prototype));
      },
    );
    OrdinaryDefineOwnProperty(realm, Thing, "prototype", { value: prototype, writable: false, enumerable: false, configurable: false });
    OrdinaryDefineOwnProperty(realm, realm.globalObject, "Thing", { value: Thing, writable: true, enumerable: false, configurable: true });
  }

  it("constructs through the callee's construct behavior with the arguments", () => {
    const seen: JSValue[][] = [];
    expect(stdoutOf("const t = new Thing(1, 'a'); console.log(typeof t);", (r) => installThing(r, seen))).toBe("object\n");
    expect(seen).toEqual([[1, "a"]]);
  });

  it("constructs a user function: the new object is `this`, an object result replaces it", () => {
    expect(stdoutOf("function F(a) { this.a = a; } function G() { return { r: 1 }; } function H() { return 5; } console.log(new F(1), new G(), new H());")).toBe(
      "F { a: 1 } { r: 1 } H {}\n",
    );
  });

  it("throws \"is not a constructor\" for an arrow, a method, an async function and a builtin that is not one", () => {
    const attempt = (callee: string): string =>
      stdoutOf(`const arrow = () => 1; const o = { m() {} }; const a = async function () {}; try { new ${callee}(); } catch (e) { console.log(e.message); }`);
    expect(attempt("arrow")).toBe("arrow is not a constructor\n");
    expect(attempt("o.m")).toBe("o.m is not a constructor\n");
    expect(attempt("a")).toBe("a is not a constructor\n");
    expect(attempt("Math.abs")).toBe("Math.abs is not a constructor\n");
  });
});

describe("call depth", () => {
  const recurse = (n: number): string => `function f(n) { return n === 0 ? 0 : 1 + f(n - 1); } console.log(f(${n}));`;

  it("allows 64 user frames, the wrapper included", () => {
    expect(stdoutOf(recurse(62))).toBe("62\n");
  });

  it("halts on the 65th user frame with the callDepth limit, not a RangeError", () => {
    expect(stopOf(recurse(63))).toEqual({ kind: "limit", limit: "callDepth" });
    expect(stopOf("function f() { f(); } f();")).toEqual({ kind: "limit", limit: "callDepth" });
  });

  it("does not count builtins as frames", () => {
    expect(stdoutOf("console.log(1);")).toBe("1\n");
  });
});

describe("CreateCatchContext", () => {
  it("binds the exception at slot 2 of a fresh context whose parent is the current one", () => {
    const program = compileOrThrow("var a = 1;");
    const realm = new Realm({ write: () => undefined, entryPoint: () => "main" });
    const interpreter = new IgnitionInterpreter(program, realm, { onCommand: () => undefined });
    const wrapper = program.functions[0];
    if (!wrapper) throw new Error("no wrapper");
    const frame = new Frame(realm.nativeFunction("w", 0, () => normal(undefined)), wrapper, undefined, []);
    const parent = new Context(null, 1);
    frame.context = parent;
    frame.registers[0] = "boom";
    const instr: Instruction = { offset: 0, opcode: "CreateCatchContext", scale: 1, operands: [local(0), 0], size: 3 };
    expect(contextHandler(interpreter, frame, instr)).toBeUndefined();
    const created = frame.accumulator;
    expect(created).toBeInstanceOf(Context);
    expect((created as Context).parent).toBe(parent);
    expect((created as Context).load(2)).toBe("boom");
  });
});

describe("calling a value that is not a function (Runtime_ThrowCalledNonCallable)", () => {
  // Messages probed on the pinned node 24.19.0.
  const PRELUDE = 'const o = { a: {} }; const k = "z"; let u; ';
  it.each([
    ["u()", "u is not a function"],
    ["o.b()", "o.b is not a function"],
    ["o.a.c()", "o.a.c is not a function"],
    ['o["s p"]()', "o.s p is not a function"],
    ["o[0]()", "o[0] is not a function"],
    ["o[1.5]()", "o[1.5] is not a function"],
    ["o[k]()", "o[k] is not a function"],
    ["o?.b()", "o?.b is not a function"],
    ["o.a?.c()", "o.a?.c is not a function"],
    ['o?.["q"]()', "o?.q is not a function"],
    ["o.a[k]()", "o.a[k] is not a function"],
    ["const m = { f() { return this.q(); } }; m.f()", "this.q is not a function"],
    ["(() => o)()()", "(intermediate value)(...) is not a function"],
    ["(function () {}).q()", "(intermediate value).q is not a function"],
    ["(function () {}.q)()", "(intermediate value).q is not a function"],
    ["new Array().q()", "(intermediate value).q is not a function"],
    ["(1)()", "1 is not a function"],
    ['"s"()', '"s" is not a function'],
    ['"s".q()', '"s".q is not a function'],
  ])("%s throws a TypeError naming the callee as CallPrinter prints it", (call, message) => {
    expect(uncaught(PRELUDE + call)).toBe(`TypeError: ${message}`);
  });

  it("stops when CallPrinter would print an intermediate value", () => {
    expect(stopOf(PRELUDE + "(u ? o : o)()").kind).toBe("unsupported");
  });
});
