import { describe, expect, it } from "vitest";
import { runSource } from "@/core/interpreter/interpreterTestWorld";
import type { JSObject } from "@/core/runtime/objects/JSObject";
import { Realm } from "@/core/runtime/Realm";
import { OrdinaryGet } from "@/core/runtime/spec/objectOps";

function out(source: string): string {
  const run = runSource(source);
  if (run.completion.type === "throw") throw new Error(`threw: ${run.stderr}`);
  return run.stdout;
}

describe("Object.keys", () => {
  it("lists enumerable own string keys: integer indices ascending, then insertion order", () => {
    expect(out("console.log(Object.keys({ b: 1, a: 2, 1: 3 }), Object.keys([5, , 6]), Object.keys(1), Object.keys({}));")).toBe(
      "[ '1', 'b', 'a' ] [ '0', '2' ] [] []\n",
    );
  });

  it("throws a TypeError for undefined and null, with Object.keys as the builtin frame", () => {
    const lines = out("try { Object.keys(null); } catch (e) { console.log(e.stack); }").split("\n");
    expect(lines.slice(0, 2)).toEqual(["TypeError: Cannot convert undefined or null to object", "    at Object.keys (<anonymous>)"]);
  });
});

describe("Object and Array constructors", () => {
  it("are reachable from their prototypes, named, with length 1", () => {
    const realm = new Realm({ write() {}, entryPoint: () => "main" });
    const ctor = (proto: JSObject) => OrdinaryGet(proto, "constructor") as JSObject;
    expect(ctor(realm.intrinsics.arrayPrototype)).toBe(OrdinaryGet(realm.globalObject, "Array"));
    expect(ctor(realm.intrinsics.objectPrototype)).toBe(OrdinaryGet(realm.globalObject, "Object"));
    expect(OrdinaryGet(ctor(realm.intrinsics.arrayPrototype), "name")).toBe("Array");
    expect(OrdinaryGet(ctor(realm.intrinsics.arrayPrototype), "length")).toBe(1);
  });
});
