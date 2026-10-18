import { describe, expect, it } from "vitest";
import { JSError, errorStack } from "@/core/runtime/builtins/errors";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSObject } from "@/core/runtime/objects/JSObject";
import { JSMessageObject } from "@/core/runtime/objects/JSMessageObject";
import { Realm } from "@/core/runtime/Realm";
import { OrdinaryDefineOwnProperty, OrdinaryGet } from "@/core/runtime/spec/objectOps";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { sourceRangeForPos } from "@/core/views/types";
import { isThrow, normal } from "./Completion";
import { compileOrThrow, runSource } from "./interpreterTestWorld";
import { IgnitionInterpreter } from "./IgnitionInterpreter";

// Throw/ReThrow, the handler-table unwinder, the pending message and the token dispatch after a
// finally block. The programs' expected output is plain JS semantics; the fixture replay in
// tests/conformance/interpreter-fixtures.test.ts checks the same paths against real Node.

function stdoutOf(source: string, setup?: (realm: Realm) => void): string {
  const run = runSource(source, setup);
  expect(run.completion.type, run.stderr).toBe("normal");
  return run.stdout;
}

/**
 * Installs `each(list, fn)`: a native that calls `fn` back for each element of an array, the way
 * Array.prototype.forEach does, and returns a callback's throw completion unchanged.
 */
function installEach(realm: Realm, log: string[] = []): void {
  const each = realm.nativeFunction("each", 2, (r, _receiver, args) => {
    const [list, fn] = args;
    if (!(fn instanceof JSFunction)) return r.throwTypeError("each needs a function");
    const length = OrdinaryGet(list as JSObject, "length") as number;
    for (let i = 0; i < length; i++) {
      const done = r.call(fn, undefined, [OrdinaryGet(list as JSObject, String(i))]);
      if (isThrow(done)) {
        log.push(`each saw a throw at ${i}`);
        return done;
      }
    }
    return normal(undefined);
  });
  OrdinaryDefineOwnProperty(realm, realm.globalObject, "each", { value: each, writable: true, enumerable: false, configurable: true });
}

describe("Throw and the handler table", () => {
  it("catches a thrown value in the same function and binds it", () => {
    expect(stdoutOf("try { throw 'x'; } catch (e) { console.log('caught', e); }")).toBe("caught x\n");
  });

  it("catches an exception thrown by a callee, any number of frames down", () => {
    expect(
      stdoutOf(`
        function inner() { throw new Error('deep'); }
        function middle() { inner(); console.log('not reached'); }
        try { middle(); } catch (e) { console.log(e.message); }
        console.log('after');
      `),
    ).toBe("deep\nafter\n");
  });

  it("catches a TypeError the interpreter raises (a property load on undefined)", () => {
    expect(stdoutOf("let u; try { u.x; } catch (e) { console.log(e.name, e.message); }")).toBe(
      "TypeError Cannot read properties of undefined (reading 'x')\n",
    );
  });

  it("picks the innermost handler whose range contains the throw", () => {
    expect(
      stdoutOf(`
        try {
          try { throw 1; } catch (a) { console.log('inner', a); throw 2; }
        } catch (b) { console.log('outer', b); }
      `),
    ).toBe("inner 1\nouter 2\n");
  });

  it("restores the context register of the try, popping block contexts pushed inside it", () => {
    expect(
      stdoutOf(`
        function f() {
          let outer = 'function scope';
          const read = () => outer;
          try {
            let inner = 'block scope';
            const keep = () => inner;
            keep();
            throw 0;
          } catch (e) {
            console.log(read(), outer);
          }
        }
        f();
      `),
    ).toBe("function scope function scope\n");
  });

  it("gives a captured catch binding its own catch context", () => {
    expect(stdoutOf("let get; try { throw 'kept'; } catch (e) { get = () => e; } console.log(get());")).toBe("kept\n");
  });

  it("leaves an uncaught exception to runScript's caller, value unchanged", () => {
    const run = runSource("throw { tag: 'm' };");
    expect(run.completion.type).toBe("throw");
    expect(OrdinaryGet(run.completion.value as JSObject, "tag")).toBe("m");
  });

  it("unwinds a loop's iterations: a catch inside the loop body continues it", () => {
    expect(stdoutOf("for (let i = 0; i < 3; i++) { try { if (i === 1) throw i; console.log('ok', i); } catch (e) { console.log('caught', e); } }")).toBe(
      "ok 0\ncaught 1\nok 2\n",
    );
  });
});

describe("finally", () => {
  it("runs on fall-through, on return and on throw, and rethrows afterwards", () => {
    expect(
      stdoutOf(`
        function fall() { try { console.log('t'); } finally { console.log('f'); } return 'r'; }
        function ret() { try { return 'from try'; } finally { console.log('f'); } }
        function thr() { try { throw new Error('e'); } finally { console.log('f'); } }
        console.log(fall());
        console.log(ret());
        try { thr(); } catch (e) { console.log('rethrown', e.message); }
      `),
    ).toBe("t\nf\nr\nf\nfrom try\nf\nrethrown e\n");
  });

  it("lets a return or a throw in finally override the pending completion", () => {
    expect(
      stdoutOf(`
        function swallow() { try { throw 1; } finally { return 'finally wins'; } }
        function replace() { try { throw 1; } finally { throw 2; } }
        console.log(swallow());
        try { replace(); } catch (e) { console.log('caught', e); }
      `),
    ).toBe("finally wins\ncaught 2\n");
  });

  it("dispatches break and continue tokens through the finally block", () => {
    expect(
      stdoutOf(`
        for (let i = 0; i < 4; i++) {
          try { if (i === 1) continue; if (i === 3) break; console.log('body', i); }
          finally { console.log('finally', i); }
        }
      `),
    ).toBe("body 0\nfinally 0\nfinally 1\nbody 2\nfinally 2\nfinally 3\n");
  });
});

describe("the pending message (V8's Isolate pending_message)", () => {
  function uncaughtRun(source: string): { message: JSMessageObject; text: string } {
    const program = compileOrThrow(source);
    const realm = new Realm({ write: () => undefined, entryPoint: () => "main" });
    const interpreter = new IgnitionInterpreter(program, realm, { onCommand: () => undefined });
    expect(interpreter.runScript().type).toBe("throw");
    const message = interpreter.pendingMessage;
    if (!(message instanceof JSMessageObject)) throw new Error("no pending message after an uncaught throw");
    const range = sourceRangeForPos(program, message.pos);
    if (!range) throw new Error("the message position has no source range");
    return { message, text: source.slice(range.start) };
  }

  it("is the position of the throw statement", () => {
    expect(uncaughtRun("const a = 1;\nthrow new Error('x');\n").text).toMatch(/^throw/);
  });

  it("keeps the original throw position when finally rethrows", () => {
    const source = "function f() { try { throw new Error('orig'); } finally { const z = 1; } }\nf();\n";
    const { text } = uncaughtRun(source);
    expect(text).toMatch(/^throw new Error\('orig'\)/);
  });

  it("is the property load for a TypeError the interpreter raises", () => {
    expect(uncaughtRun("let u;\nu.prop;\n").text).toContain("prop");
  });

  it("is replaced by a later throw once a catch has cleared it", () => {
    const source = "try { throw 1; } catch (e) {}\nconst q = 2;\nthrow 3;\n";
    const { message } = uncaughtRun(source);
    const range = sourceRangeForPos(compileOrThrow(source), message.pos);
    expect(range && source.slice(range.start)).toMatch(/^throw 3/);
  });

  it("is cleared by a catch, so a program that recovers has none", () => {
    const program = compileOrThrow("try { throw 1; } catch (e) {}");
    const realm = new Realm({ write: () => undefined, entryPoint: () => "main" });
    const interpreter = new IgnitionInterpreter(program, realm, { onCommand: () => undefined });
    expect(interpreter.runScript().type).toBe("normal");
    expect(interpreter.pendingMessage).toBeUndefined();
  });
});

describe("unwinding through a re-entrant builtin frame", () => {
  it("carries a callback's throw out through the builtin to the caller's handler", () => {
    const log: string[] = [];
    expect(
      stdoutOf(
        `
        try {
          each([1, 2, 3], (x) => { if (x === 2) throw new Error('stop at ' + x); console.log('visit', x); });
        } catch (e) {
          console.log('caught', e.message);
        }
        console.log('after');
        `,
        (r) => installEach(r, log),
      ),
    ).toBe("visit 1\ncaught stop at 2\nafter\n");
    expect(log).toEqual(["each saw a throw at 1"]);
  });

  it("lets a callback catch its own exception, so the builtin keeps going", () => {
    expect(
      stdoutOf("each([1, 2], (x) => { try { throw x; } catch (e) { console.log('inner', e); } });", (r) => installEach(r)),
    ).toBe("inner 1\ninner 2\n");
  });

  it("keeps the callback's throw position as the message, not the builtin call's", () => {
    const source = "each([1], (x) => {\n  throw x;\n});\n";
    const program = compileOrThrow(source);
    const realm = new Realm({ write: () => undefined, entryPoint: () => "main" });
    installEach(realm);
    const interpreter = new IgnitionInterpreter(program, realm, { onCommand: () => undefined });
    expect(interpreter.runScript().type).toBe("throw");
    const message = interpreter.pendingMessage as JSMessageObject;
    const range = sourceRangeForPos(program, message.pos);
    expect(range && source.slice(range.start)).toMatch(/^throw x/);
  });

  it("puts the message of a builtin's own throw at the call that entered it", () => {
    const source = "const n = 1;\neach([1], 5);\n";
    const program = compileOrThrow(source);
    const realm = new Realm({ write: () => undefined, entryPoint: () => "main" });
    installEach(realm);
    const interpreter = new IgnitionInterpreter(program, realm, { onCommand: () => undefined });
    const completion = interpreter.runScript();
    expect(completion.type).toBe("throw");
    const message = interpreter.pendingMessage as JSMessageObject;
    const range = sourceRangeForPos(program, message.pos);
    expect(range && source.slice(range.start)).toMatch(/^each\(/);
    expect(OrdinaryGet(completion.value as JSObject, "message") as JSValue).toBe("each needs a function");
  });
});

describe("the Error constructors a throw statement needs (the rest of Error arrives with Task 14)", () => {
  it("constructs each kind with and without new, with message as an own non-enumerable property", () => {
    expect(
      stdoutOf(`
        const a = new Error('m'), b = TypeError('t'), c = new RangeError(), d = new ReferenceError(7), s = new SyntaxError('x');
        console.log(a.name, a.message, b.name, b.message, c.name, c.message === '', d.message, s.name);
        console.log(typeof Error, typeof TypeError);
      `),
    ).toBe("Error m TypeError t RangeError true 7 SyntaxError\nfunction function\n");
  });

  it("captures the call sites where the error is constructed", () => {
    const run = runSource("function make() { throw new Error('here'); }\nmake();\n");
    expect(run.completion.type).toBe("throw");
    const error = run.completion.value as JSError;
    expect(error).toBeInstanceOf(JSError);
    expect(errorStack(error).split("\n").slice(0, 3)).toEqual(["Error: here", "    at make (main.cjs:1:25)", "    at Object.<anonymous> (main.cjs:2:1)"]);
  });
});
