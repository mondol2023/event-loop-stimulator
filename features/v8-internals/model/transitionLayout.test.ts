import { describe, expect, it } from "vitest";
import type { MapSnapshot } from "@/core/timeline/Tick";
import type { MapId } from "@/core/shared/ids";
import { transitionLayout } from "./transitionLayout";

const id = (n: number): MapId => n as MapId;

function map(n: number, parent: number | null, key: string | null): MapSnapshot {
  return {
    id: id(n),
    family: "ordinary",
    instanceType: "JS_OBJECT_TYPE",
    elementsKind: "HOLEY_ELEMENTS",
    isDictionary: false,
    deprecated: false,
    inObjectCapacity: 4,
    backPointer: parent === null ? null : id(parent),
    fields: key === null ? [] : [{ key, representation: "Smi", location: "field", enumerable: true }],
  } as unknown as MapSnapshot;
}

describe("transitionLayout", () => {
  it("lays a tree on integer grid cells and keys each edge by the field the child added", () => {
    const out = transitionLayout([map(1, null, null), map(2, 1, "x"), map(3, 1, "y")]);
    expect(out.hidden).toBe(0);
    expect(out.edges).toEqual([
      { from: id(1), to: id(2), key: "x" },
      { from: id(1), to: id(3), key: "y" },
    ]);
    for (const n of out.nodes) {
      expect(Number.isInteger(n.x)).toBe(true);
      expect(Number.isInteger(n.y)).toBe(true);
    }
    expect(out.nodes.find((n) => n.id === id(2))?.y).toBe(1);
  });

  it("keeps the focus Map's ancestors and reports what it left out over the cap", () => {
    const maps: MapSnapshot[] = [map(1, null, null)];
    for (let i = 2; i <= 290; i++) maps.push(map(i, 1, `k${i}`));
    maps.push(map(291, 2, "a"), map(292, 291, "b"), map(293, 292, "c"));
    for (let i = 294; i <= 300; i++) maps.push(map(i, 1, `k${i}`));
    const out = transitionLayout(maps, id(293));
    expect(out.nodes.length).toBeLessThanOrEqual(128);
    expect(out.hidden).toBe(300 - out.nodes.length);
    const ids = new Set(out.nodes.map((n) => n.id));
    for (const ancestor of [293, 292, 291, 2, 1]) expect(ids.has(id(ancestor))).toBe(true);
    expect(out.nodes.find((n) => n.id === id(293))?.current).toBe(true);
    expect(transitionLayout(maps, id(293))).toEqual(out);
  });
});
