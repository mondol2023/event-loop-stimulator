import { describe, expect, it } from "vitest";
import { DETACHED_HOST } from "@/core/host/NodeEventLoop";
import type { JSObject } from "@/core/runtime/objects/JSObject";
import { Realm } from "@/core/runtime/Realm";
import { OrdinaryGet } from "@/core/runtime/spec/objectOps";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { simulate } from "@/core/timeline/simulate";
import { NODE_MEMBERS } from "./nodeMembers";

// A member that real Node has and the model lacks must stop the run, never read as `undefined`
// (which would surface as a made-up "x is not a function").

function run(source: string) {
  const r = simulate(source, "js", { record: false });
  expect(r.diagnostics).toEqual([]);
  return r;
}

describe("members of Node's builtins that are not modeled", () => {
  it.each([
    ['console.log([1, 2].slice(0));', "Array.prototype.slice"],
    ['console.log("abc".trim());', "String.prototype.trim"],
    ["console.log(({}).isPrototypeOf);", "Object.prototype.isPrototypeOf"],
    ["console.log((1).toFixed(2));", "Number.prototype.toFixed"],
    ['console.log(new Error("e").toLocaleString);', "Object.prototype.toLocaleString"],
  ])("%s stops as unsupported, naming %s", (source, member) => {
    const r = run(source);
    expect(r.stop).toMatchObject({ kind: "unsupported" });
    expect(r.stop?.kind === "unsupported" && r.stop.reason).toContain(member);
  });

  it("a name Node does not have reads as undefined, and a modeled member is found", () => {
    const r = run('const a = [1]; console.log(a.nothing, ({}).missing, "s".nothing, typeof a.map, typeof "s".valueOf, typeof (1).toString);');
    expect(r.stop).toBeUndefined();
    expect(r.stdout).toBe("undefined undefined undefined function function function\n");
  });

  it("an own property shadows the unmodeled member of the prototype", () => {
    const r = run("const a = [1]; a.slice = function () { return 7; }; console.log(a.slice());");
    expect(r.stop).toBeUndefined();
    expect(r.stdout).toBe("7\n");
  });

  it("the realm halts on the statics the validator keeps out of programs, and finds the ones it models", () => {
    const realm = new Realm(DETACHED_HOST);
    const global = (name: string) => OrdinaryGet(realm.globalObject, name) as JSObject;
    expect(() => realm.requireModeled(global("Object"), "assign")).toThrow(SimulationHalt);
    expect(() => realm.requireModeled(global("Array"), "isArray")).toThrow(/Array\.isArray/);
    expect(() => realm.requireModeled(global("Math"), "cbrt")).toThrow(SimulationHalt);
    expect(() => realm.requireModeled(global("Object"), "keys")).not.toThrow();
    expect(() => realm.requireModeled(global("Math"), "floor")).not.toThrow();
    expect(() => realm.requireModeled(global("Object"), "notAThing")).not.toThrow();
  });

  it("lists only string keys and none of the names every function or constructor has", () => {
    for (const members of Object.values(NODE_MEMBERS)) {
      for (const name of ["constructor", "length", "name", "prototype", "caller", "arguments"]) expect(members).not.toContain(name);
    }
  });
});
