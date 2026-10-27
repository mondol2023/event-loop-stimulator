import { describe, expect, it } from "vitest";
import type { ElementsKind } from "@/core/runtime/objects/ElementsKind";
import { latestChangedElements } from "./elementsFocus";

const at = (kinds: readonly Record<number, ElementsKind>[]) => (i: number) => ({ v8: { elementsKinds: kinds[i] ?? {} } });

describe("latestChangedElements", () => {
  const kinds: Record<number, ElementsKind>[] = [
    {},
    { 4: "PACKED_SMI_ELEMENTS" },
    { 4: "PACKED_SMI_ELEMENTS" },
    { 4: "PACKED_DOUBLE_ELEMENTS" },
    { 4: "PACKED_DOUBLE_ELEMENTS", 6: "PACKED_ELEMENTS" },
    { 4: "PACKED_DOUBLE_ELEMENTS", 6: "PACKED_ELEMENTS" },
  ];

  it("is null while no object has an elements kind", () => {
    expect(latestChangedElements(at(kinds), 0)).toBeNull();
  });

  it("finds an array the moment it appears", () => {
    expect(latestChangedElements(at(kinds), 1)).toEqual({ objectId: 4, kind: "PACKED_SMI_ELEMENTS" });
  });

  it("keeps the last change while later ticks change nothing", () => {
    expect(latestChangedElements(at(kinds), 2)).toEqual({ objectId: 4, kind: "PACKED_SMI_ELEMENTS" });
    expect(latestChangedElements(at(kinds), 3)).toEqual({ objectId: 4, kind: "PACKED_DOUBLE_ELEMENTS" });
  });

  it("moves to another array when that one changes later", () => {
    expect(latestChangedElements(at(kinds), 5)).toEqual({ objectId: 6, kind: "PACKED_ELEMENTS" });
  });
});
