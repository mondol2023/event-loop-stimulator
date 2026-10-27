import { describe, expect, it } from "vitest";
import { latticeModel } from "./latticeModel";

describe("latticeModel", () => {
  it("has 7 fixed nodes", () => {
    const m = latticeModel(null);
    expect(m.nodes).toHaveLength(7);
    expect(m.nodes.every((n) => !n.current && !n.reachable)).toBe(true);
    expect(latticeModel(null)).toEqual(m);
  });

  it("from PACKED_DOUBLE, PACKED_SMI is unreachable and HOLEY_DOUBLE is reachable", () => {
    const by = new Map(latticeModel("PACKED_DOUBLE_ELEMENTS").nodes.map((n) => [n.kind, n]));
    expect(by.get("PACKED_DOUBLE_ELEMENTS")?.current).toBe(true);
    expect(by.get("PACKED_SMI_ELEMENTS")?.reachable).toBe(false);
    expect(by.get("HOLEY_SMI_ELEMENTS")?.reachable).toBe(false);
    expect(by.get("HOLEY_DOUBLE_ELEMENTS")?.reachable).toBe(true);
    expect(by.get("DICTIONARY_ELEMENTS")?.reachable).toBe(true);
  });

  it("has the one-way edges", () => {
    const { edges } = latticeModel(null);
    const has = (a: string, b: string) => edges.some((e) => e.from === a && e.to === b);
    expect(has("PACKED_SMI_ELEMENTS", "PACKED_DOUBLE_ELEMENTS")).toBe(true);
    expect(has("PACKED_DOUBLE_ELEMENTS", "PACKED_ELEMENTS")).toBe(true);
    expect(has("HOLEY_SMI_ELEMENTS", "HOLEY_DOUBLE_ELEMENTS")).toBe(true);
    expect(has("PACKED_ELEMENTS", "HOLEY_ELEMENTS")).toBe(true);
    expect(has("HOLEY_ELEMENTS", "PACKED_ELEMENTS")).toBe(false);
    expect(has("HOLEY_ELEMENTS", "DICTIONARY_ELEMENTS")).toBe(true);
    expect(edges.some((e) => e.from === "DICTIONARY_ELEMENTS")).toBe(false);
  });
});
