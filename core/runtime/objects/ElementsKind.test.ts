import { describe, expect, it } from "vitest";
import { generalizeElementsKind, isHoleyKind } from "./ElementsKind";

describe("generalizeElementsKind", () => {
  it("keeps PACKED_SMI for a Smi and widens to DOUBLE for 1.5", () => {
    expect(generalizeElementsKind("PACKED_SMI_ELEMENTS", 4)).toBe("PACKED_SMI_ELEMENTS");
    expect(generalizeElementsKind("PACKED_SMI_ELEMENTS", 1.5)).toBe("PACKED_DOUBLE_ELEMENTS");
  });

  it("widens DOUBLE to ELEMENTS for a non-number and never back", () => {
    expect(generalizeElementsKind("PACKED_DOUBLE_ELEMENTS", "x")).toBe("PACKED_ELEMENTS");
    expect(generalizeElementsKind("PACKED_DOUBLE_ELEMENTS", 3)).toBe("PACKED_DOUBLE_ELEMENTS");
    expect(generalizeElementsKind("PACKED_ELEMENTS", 1)).toBe("PACKED_ELEMENTS");
    expect(generalizeElementsKind("PACKED_ELEMENTS", 1.5)).toBe("PACKED_ELEMENTS");
  });

  it("treats -0, NaN and 2**31 as doubles", () => {
    for (const v of [-0, NaN, 2 ** 31, Infinity]) {
      expect(generalizeElementsKind("PACKED_SMI_ELEMENTS", v)).toBe("PACKED_DOUBLE_ELEMENTS");
    }
  });

  it("treats undefined, null and booleans as tagged values", () => {
    for (const v of [undefined, null, true]) {
      expect(generalizeElementsKind("PACKED_SMI_ELEMENTS", v)).toBe("PACKED_ELEMENTS");
    }
  });

  it("moves PACKED to HOLEY on a hole and keeps the value kind", () => {
    expect(generalizeElementsKind("PACKED_SMI_ELEMENTS", "hole")).toBe("HOLEY_SMI_ELEMENTS");
    expect(generalizeElementsKind("PACKED_DOUBLE_ELEMENTS", "hole")).toBe("HOLEY_DOUBLE_ELEMENTS");
    expect(generalizeElementsKind("PACKED_ELEMENTS", "hole")).toBe("HOLEY_ELEMENTS");
    expect(generalizeElementsKind("HOLEY_SMI_ELEMENTS", 1.5)).toBe("HOLEY_DOUBLE_ELEMENTS");
  });

  it("leaves DICTIONARY_ELEMENTS alone", () => {
    expect(generalizeElementsKind("DICTIONARY_ELEMENTS", "x")).toBe("DICTIONARY_ELEMENTS");
    expect(generalizeElementsKind("DICTIONARY_ELEMENTS", "hole")).toBe("DICTIONARY_ELEMENTS");
  });

  it("reports holey kinds", () => {
    expect(isHoleyKind("HOLEY_ELEMENTS")).toBe(true);
    expect(isHoleyKind("PACKED_ELEMENTS")).toBe(false);
    expect(isHoleyKind("DICTIONARY_ELEMENTS")).toBe(false);
  });
});
