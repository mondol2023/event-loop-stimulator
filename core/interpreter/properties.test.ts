import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import { JSObject } from "@/core/runtime/objects/JSObject";
import type { FeedbackVector } from "@/core/runtime/ic/FeedbackVector";
import { Realm } from "@/core/runtime/Realm";
import { OrdinaryDefineOwnProperty, OrdinaryDelete, OrdinaryGet, OrdinaryOwnPropertyKeys, OrdinarySet } from "@/core/runtime/spec/objectOps";
import { SimulationHalt, type SimulationStop } from "@/core/shared/simulationHalt";
import { runSource } from "./interpreterTestWorld";

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

function stopOf(source: string): SimulationStop {
  try {
    runSource(source);
  } catch (e) {
    expect(e).toBeInstanceOf(SimulationHalt);
    return (e as SimulationHalt).stop;
  }
  throw new Error("the run did not stop");
}

/** Installs a test-only global `probe(fn)` that hands back the FeedbackVector of a user function. */
function probe(): { vectors: FeedbackVector[]; install: (realm: Realm) => void } {
  const vectors: FeedbackVector[] = [];
  return {
    vectors,
    install(realm) {
      const fn = realm.nativeFunction("probe", 1, (_realm, _receiver, args) => {
        const target = args[0];
        if (!(target instanceof JSFunction)) throw new Error("probe wants a function");
        vectors.push(target.feedbackCell.requireVector());
        return { type: "normal", value: undefined };
      });
      OrdinaryDefineOwnProperty(realm, realm.globalObject, "probe", { value: fn, writable: true, enumerable: false, configurable: true });
    },
  };
}

describe("named and keyed loads", () => {
  it("read own and inherited properties, and undefined for a missing one", () => {
    expect(stdoutOf(`var o = { a: 1 }; console.log(o.a, o["a"], o.missing, o.toString);`)).toBe("1 1 undefined [Function: toString]\n");
  });

  it("read array elements, holes and length", () => {
    expect(stdoutOf(`var a = [10, , 30]; console.log(a[0], a[1], a[2], a[3], a.length, a["2"]);`)).toBe("10 undefined 30 undefined 3 30\n");
  });

  it("read the length and the code units of a string, and nothing else is guessed", () => {
    expect(stdoutOf(`var s = "a😀"; console.log(s.length, s[0], s[3], s["1"] === s[1]);`)).toBe("3 a undefined true\n");
    expect(stopOf(`var s = "abc"; s.toUpperCase;`)).toMatchObject({ kind: "unsupported" });
  });

  it("throw the V8 message when the receiver is undefined or null", () => {
    expect(uncaught(`var u; u.name;`)).toBe("TypeError: Cannot read properties of undefined (reading 'name')");
    expect(uncaught(`var n = null; n.name;`)).toBe("TypeError: Cannot read properties of null (reading 'name')");
    expect(uncaught(`var u; var k = 3; u[k];`)).toBe("TypeError: Cannot read properties of undefined (reading '3')");
  });
});

describe("named and keyed stores", () => {
  it("add, overwrite and index", () => {
    expect(stdoutOf(`var o = {}; o.a = 1; o["b"] = 2; o[3] = 3; o.a = 4; console.log(o.a, o.b, o[3]);`)).toBe("4 2 3\n");
  });

  it("store into an array grows it and makes holes", () => {
    expect(stdoutOf(`var a = [1]; a[3] = 4; console.log(a.length, a[1], a[3]);`)).toBe("4 undefined 4\n");
  });

  it("throw the V8 message when the receiver is undefined or null", () => {
    expect(uncaught(`var u; u.x = 1;`)).toBe("TypeError: Cannot set properties of undefined (setting 'x')");
    expect(uncaught(`var n = null; var k = "y"; n[k] = 1;`)).toBe("TypeError: Cannot set properties of null (setting 'y')");
  });

  it("set an array's length: truncates, and rejects an invalid length with a RangeError", () => {
    expect(stdoutOf(`var a = [1, 2, 3]; a.length = 1; console.log(a.length, a[1]);`)).toBe("1 undefined\n");
    expect(uncaught(`var a = []; a.length = -1;`)).toBe("RangeError: Invalid array length");
    expect(uncaught(`var a = []; a.length = 1.5;`)).toBe("RangeError: Invalid array length");
  });

  it("ignore a write to a read-only property in sloppy code", () => {
    expect(stdoutOf(`function f() {} f.name = "other"; console.log(f.name);`)).toBe("f\n");
  });
});

describe("delete", () => {
  it("returns true, also for a missing property, and removes the property", () => {
    expect(stdoutOf(`var o = { a: 1 }; console.log(delete o.a, delete o.nothing, o.a, o);`)).toBe("true true undefined {}\n");
  });

  it("returns false for a non-configurable property in sloppy code", () => {
    expect(stdoutOf(`var a = [1]; console.log(delete a.length, a.length);`)).toBe("false 1\n");
  });

  it("stops rather than guess the strict-mode TypeError for a non-configurable property", () => {
    expect(stopOf(`"use strict"; var a = [1]; delete a.length;`)).toMatchObject({ kind: "unsupported" });
  });

  it("stops rather than guess the TypeError text for undefined or null (no fixture prints it)", () => {
    expect(stopOf(`var u; delete u.x;`)).toMatchObject({ kind: "unsupported" });
  });
});

describe("literals", () => {
  it("create a fresh object or array on each evaluation", () => {
    expect(stdoutOf(`function make() { return { a: 1, list: [1, 2] }; } var p = make(); var q = make(); console.log(p === q, p.list === q.list);`)).toBe("false false\n");
  });

  it("keep property order: indexes ascending, then names as written", () => {
    expect(stdoutOf(`console.log({ b: 1, 2: "two", a: 2, 1: "one" });`)).toBe("{ '1': 'one', '2': 'two', b: 1, a: 2 }\n");
  });

  it("evaluate computed values in source order into the right slots", () => {
    expect(stdoutOf(`var n = 0; function next() { n = n + 1; return n; } console.log({ a: next(), b: 7, c: next() }, [next(), 7, next()]);`)).toBe("{ a: 1, b: 7, c: 2 } [ 3, 7, 4 ]\n");
  });
});

describe("optional chaining", () => {
  it("short-circuits a whole chain on undefined or null", () => {
    expect(stdoutOf(`var u; var n = null; var o = { a: { b: 1 } }; console.log(u?.a.b.c, n?.[0], o?.a?.b, o.x?.y.z);`)).toBe("undefined undefined 1 undefined\n");
  });
});

describe("inline-cache feedback while running", () => {
  const loads = (shapes: number): string => `
    function get(o) { return o.x; }
    ${Array.from({ length: shapes }, (_, i) => `get({ x: 1, p${i}: 1 });`).join("\n")}
    probe(get);
  `;

  it("a load site is UNINITIALIZED until called, then MONOMORPHIC, POLYMORPHIC, MEGAMORPHIC", () => {
    const states: string[] = [];
    for (const shapes of [0, 1, 3, 5]) {
      const p = probe();
      runSource(loads(shapes), p.install);
      states.push(p.vectors[0]!.slot(0).state);
    }
    expect(states).toEqual(["UNINITIALIZED", "MONOMORPHIC", "POLYMORPHIC", "MEGAMORPHIC"]);
  });

  it("a store site records the map the receiver had before the store", () => {
    const p = probe();
    runSource(`function put(o) { o.y = 1; } put({}); put({}); put({}); probe(put);`, p.install);
    expect(p.vectors[0]!.slot(0).state).toBe("MONOMORPHIC");
  });

  it("a keyed load site feeds its own slot", () => {
    const p = probe();
    runSource(`function at(a, i) { return a[i]; } at([1], 0); at([1.5], 0); at(["x"], 0); probe(at);`, p.install);
    // PACKED_SMI, PACKED_DOUBLE and PACKED_ELEMENTS arrays have three different Maps.
    expect(p.vectors[0]!.slot(0).state).toBe("POLYMORPHIC");
  });

  it("closures made at one site share their feedback", () => {
    const p = probe();
    runSource(`function make() { return function (o) { return o.x; }; } var f = make(); var g = make(); f({ x: 1 }); g({ x: 1, y: 2 }); probe(f); probe(g);`, p.install);
    expect(p.vectors[0]).toBe(p.vectors[1]);
    expect(p.vectors[0]!.slot(0).state).toBe("POLYMORPHIC");
  });
});

describe("own-key order against the host (data only)", () => {
  // The oracle compares generated *data* with host objects; no program text is evaluated.
  const keyArb = fc.constantFrom("b", "a", "z", "0", "1", "2", "10", "01", "-1", "1.5", "4294967294", "4294967295", "c d");
  const opArb = fc.oneof(
    fc.record({ op: fc.constant("set" as const), key: keyArb }),
    fc.record({ op: fc.constant("delete" as const), key: keyArb }),
  );

  it("OrdinaryOwnPropertyKeys equals Object.keys after any sequence of stores and deletes", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const realm = new Realm({ write: () => undefined, entryPoint: () => "main" });
        const obj = realm.newObject();
        const host: Record<string, number> = {};
        ops.forEach((o, i) => {
          if (o.op === "set") {
            OrdinarySet(realm, obj, o.key, i);
            host[o.key] = i;
          } else {
            OrdinaryDelete(realm, obj, o.key);
            delete host[o.key];
          }
        });
        expect(OrdinaryOwnPropertyKeys(obj)).toEqual(Object.keys(host));
      }),
      { numRuns: 500 },
    );
  });
});
