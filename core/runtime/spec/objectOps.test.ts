import { describe, expect, it } from "vitest";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { Heap } from "../heap/Heap";
import { JSArray } from "../objects/JSArray";
import { JSObject } from "../objects/JSObject";
import { TransitionTree } from "../objects/TransitionTree";
import { TheHole } from "../values/TheHole";
import type { JSValue } from "../values/JSValue";
import {
  OrdinaryDefineOwnProperty,
  OrdinaryDelete,
  OrdinaryGet,
  OrdinaryGetOwnProperty,
  OrdinaryOwnPropertyKeys,
  OrdinarySet,
} from "./objectOps";

function world() {
  const heap = new Heap();
  const maps = new TransitionTree();
  const ctx = { maps };
  const object = (props: Record<string, JSValue> = {}, proto: JSObject | null = null): JSObject => {
    const entries = Object.entries(props);
    const o = heap.allocate((id) => new JSObject(id, maps.rootFor("object-literal", entries.length), proto));
    for (const [k, v] of entries) OrdinarySet(ctx, o, k, v);
    return o;
  };
  const array = (...values: (JSValue | typeof TheHole)[]): JSArray =>
    heap.allocate((id) => JSArray.fromElements(id, maps, null, values));
  return { heap, maps, ctx, object, array };
}

describe("OrdinaryOwnPropertyKeys", () => {
  it("lists integer indices ascending, then string keys in insertion order", () => {
    const { ctx, object } = world();
    const o = object();
    for (const k of ["b", "2", "a", "1"]) OrdinarySet(ctx, o, k, 0);
    expect(OrdinaryOwnPropertyKeys(o)).toEqual(["1", "2", "b", "a"]);
  });

  it("keeps insertion order across a delete into dictionary mode, and re-adding goes last", () => {
    const { ctx, object } = world();
    const o = object({ x: 1, y: 2, z: 3 });
    expect(OrdinaryDelete(ctx, o, "x")).toBe(true);
    expect(o.map.isDictionary).toBe(true);
    OrdinarySet(ctx, o, "x", 9);
    expect(OrdinaryOwnPropertyKeys(o)).toEqual(["y", "z", "x"]);
    expect(OrdinaryGet(o, "x")).toBe(9);
  });

  it("lists an array's elements, then length, then its named properties", () => {
    const { ctx, array } = world();
    const a = array(1, 2);
    OrdinarySet(ctx, a, "tag", "t");
    expect(OrdinaryOwnPropertyKeys(a)).toEqual(["0", "1", "length", "tag"]);
  });
});

describe("get, set, define and delete", () => {
  it("reads through the prototype chain and writes on the receiver", () => {
    const { ctx, object } = world();
    const proto = object({ inherited: 1 });
    const o = object({}, proto);
    expect(OrdinaryGet(o, "inherited")).toBe(1);
    expect(OrdinarySet(ctx, o, "inherited", 2)).toBe(true);
    expect(OrdinaryGet(proto, "inherited")).toBe(1);
    expect(OrdinaryGetOwnProperty(o, "inherited")?.value).toBe(2);
    expect(OrdinaryGet(o, "missing")).toBeUndefined();
  });

  it("refuses to set over a non-writable inherited property", () => {
    const { ctx, object } = world();
    const proto = object();
    OrdinaryDefineOwnProperty(ctx, proto, "k", { value: 1, writable: false, enumerable: true, configurable: true });
    const o = object({}, proto);
    expect(OrdinarySet(ctx, o, "k", 2)).toBe(false);
    expect(OrdinaryGetOwnProperty(o, "k")).toBeUndefined();
  });

  it("applies validate-and-apply rules for a non-configurable property", () => {
    const { ctx, object } = world();
    const o = object();
    expect(OrdinaryDefineOwnProperty(ctx, o, "k", { value: 1, writable: false, enumerable: false, configurable: false })).toBe(true);
    expect(OrdinaryDefineOwnProperty(ctx, o, "k", { value: 2 })).toBe(false);
    expect(OrdinaryDefineOwnProperty(ctx, o, "k", { value: 1 })).toBe(true);
    expect(OrdinaryDefineOwnProperty(ctx, o, "k", { enumerable: true })).toBe(false);
    expect(OrdinaryDelete(ctx, o, "k")).toBe(false);
    expect(OrdinaryGetOwnProperty(o, "k")).toEqual({ value: 1, writable: false, enumerable: false, configurable: false });
  });

  it("reports missing properties as deleted", () => {
    const { ctx, object } = world();
    expect(OrdinaryDelete(ctx, object(), "nope")).toBe(true);
  });

  it("halts on an element with non-default attributes", () => {
    const { ctx, array } = world();
    expect(() => OrdinaryDefineOwnProperty(ctx, array(1), "0", { value: 1, enumerable: false })).toThrow(SimulationHalt);
  });
});

describe("Map identity through property operations", () => {
  it("shares a Map for the same additions and changes it on delete", () => {
    const { ctx, object } = world();
    const a = object({ x: 1, y: 2 });
    const b = object({ x: 3, y: 4 });
    expect(a.map).toBe(b.map);
    OrdinaryDelete(ctx, a, "y");
    expect(a.map).not.toBe(b.map);
    expect(a.map.isDictionary).toBe(true);
  });

  it("generalizes a field Smi to Double with a new Map, migrating lazily", () => {
    const { ctx, object } = world();
    const a = object({ f: 1 });
    const b = object({ f: 2 });
    const shared = a.map;
    OrdinarySet(ctx, a, "f", 1.5);
    expect(a.map).not.toBe(b.map);
    expect(b.map).toBe(shared);
    expect(shared.deprecated).toBe(true);
    OrdinarySet(ctx, a, "f", "text");
    const c = object({ f: 3 });
    expect(c.map).toBe(a.map);
    expect(b.map).not.toBe(c.map);
    OrdinarySet(ctx, b, "f", {} as never);
    expect(b.map).toBe(c.map);
  });

  it("keeps values readable through generalization", () => {
    const { ctx, object } = world();
    const a = object({ p: 1, q: 2 });
    OrdinarySet(ctx, a, "p", 0.25);
    expect([OrdinaryGet(a, "p"), OrdinaryGet(a, "q")]).toEqual([0.25, 2]);
  });
});

describe("arrays", () => {
  const kind = (a: JSObject) => a.map.elementsKind;

  it("starts from the literal's elements kind and shares Maps per kind", () => {
    const { array } = world();
    expect(kind(array(1, 2, 3))).toBe("PACKED_SMI_ELEMENTS");
    expect(kind(array(1.5, 2))).toBe("PACKED_DOUBLE_ELEMENTS");
    expect(kind(array({} as never, "s"))).toBe("PACKED_ELEMENTS");
    expect(kind(array(1, TheHole, 3))).toBe("HOLEY_SMI_ELEMENTS");
    expect(array(1).map).toBe(array(2).map);
    expect(array().map).not.toBe(array(1.5).map);
  });

  it("keeps an element whose value is undefined, distinct from a hole", () => {
    const { ctx, array } = world();
    const a = array(undefined, TheHole, null);
    expect(OrdinaryGetOwnProperty(a, "0")).toEqual({ value: undefined, writable: true, enumerable: true, configurable: true });
    expect(OrdinaryGetOwnProperty(a, "1")).toBeUndefined();
    expect(OrdinaryOwnPropertyKeys(a)).toEqual(["0", "2", "length"]);
    OrdinarySet(ctx, a, "1", undefined);
    expect(OrdinaryGetOwnProperty(a, "1")?.value).toBeUndefined();
    expect(OrdinaryGetOwnProperty(a, "1")).toBeDefined();
  });

  it("moves PACKED_SMI to DOUBLE to tagged on writes, never back", () => {
    const { ctx, array } = world();
    const a = array(1, 2, 3);
    OrdinarySet(ctx, a, "3", 4);
    expect(kind(a)).toBe("PACKED_SMI_ELEMENTS");
    OrdinarySet(ctx, a, "4", 4.5);
    expect(kind(a)).toBe("PACKED_DOUBLE_ELEMENTS");
    OrdinarySet(ctx, a, "5", "x");
    expect(kind(a)).toBe("PACKED_ELEMENTS");
    expect(OrdinaryGet(a, "length")).toBe(6);
    OrdinarySet(ctx, a, "length", 4);
    expect(kind(a)).toBe("PACKED_ELEMENTS");
  });

  it("creates holes by writing past the end and keeps HOLEY after filling them", () => {
    const { ctx, array } = world();
    const a = array(1, 2, 3);
    OrdinarySet(ctx, a, "5", 6);
    expect(kind(a)).toBe("HOLEY_SMI_ELEMENTS");
    expect(OrdinaryGetOwnProperty(a, "3")).toBeUndefined();
    expect(OrdinaryOwnPropertyKeys(a)).toEqual(["0", "1", "2", "5", "length"]);
    OrdinarySet(ctx, a, "3", 4);
    OrdinarySet(ctx, a, "4", 5);
    expect(kind(a)).toBe("HOLEY_SMI_ELEMENTS");
  });

  it("makes an array holey on delete and when length grows", () => {
    const { ctx, array } = world();
    const a = array(1, 2, 3);
    OrdinaryDelete(ctx, a, "1");
    expect(kind(a)).toBe("HOLEY_SMI_ELEMENTS");
    expect(OrdinaryGet(a, "length")).toBe(3);
    const b = array(1);
    OrdinarySet(ctx, b, "length", 4);
    expect(kind(b)).toBe("HOLEY_SMI_ELEMENTS");
    expect(OrdinaryGet(b, "length")).toBe(4);
  });

  it("goes to DICTIONARY_ELEMENTS for a far write and keeps working", () => {
    const { ctx, array } = world();
    const a = array(1);
    OrdinarySet(ctx, a, "100000", 2);
    expect(kind(a)).toBe("DICTIONARY_ELEMENTS");
    expect(OrdinaryGet(a, "length")).toBe(100001);
    expect(OrdinaryOwnPropertyKeys(a)).toEqual(["0", "100000", "length"]);
    OrdinarySet(ctx, a, "length", 1);
    expect(OrdinaryOwnPropertyKeys(a)).toEqual(["0", "length"]);
  });

  it("holds a huge length without allocating elements", () => {
    const { ctx, array } = world();
    const a = array();
    OrdinarySet(ctx, a, "length", 4294967295);
    expect(OrdinaryGet(a, "length")).toBe(4294967295);
    expect(kind(a)).toBe("DICTIONARY_ELEMENTS");
  });

  it("reports length as a non-enumerable, non-configurable own property", () => {
    const { array } = world();
    expect(OrdinaryGetOwnProperty(array(1, 2), "length")).toEqual({
      value: 2,
      writable: true,
      enumerable: false,
      configurable: false,
    });
  });

  it("treats 4294967295 and non-canonical numerals as named keys, not indices", () => {
    const { ctx, array } = world();
    const a = array();
    OrdinarySet(ctx, a, "4294967295", 1);
    OrdinarySet(ctx, a, "01", 1);
    OrdinarySet(ctx, a, "-1", 1);
    expect(OrdinaryGet(a, "length")).toBe(0);
    expect(OrdinaryOwnPropertyKeys(a)).toEqual(["length", "4294967295", "01", "-1"]);
  });
});
