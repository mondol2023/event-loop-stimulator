import { describe, expect, it } from "vitest";
import { isSmi } from "./Smi";
import { taggedSmi } from "./tagging";

describe("isSmi (31-bit, pointer compression)", () => {
  it("rejects 2**30 and -0", () => {
    expect(isSmi(2 ** 30)).toBe(false);
    expect(isSmi(-0)).toBe(false);
  });
  it("accepts the 31-bit range ends", () => {
    expect(isSmi(-(2 ** 30))).toBe(true);
    expect(isSmi(2 ** 30 - 1)).toBe(true);
    expect(isSmi(0)).toBe(true);
  });
  it("rejects non-integers and non-finite values", () => {
    expect(isSmi(1.5)).toBe(false);
    expect(isSmi(NaN)).toBe(false);
    expect(isSmi(Infinity)).toBe(false);
    expect(isSmi(-(2 ** 30) - 1)).toBe(false);
  });
});

describe("taggedSmi", () => {
  it("prints (n << 1) as a uint32", () => {
    expect(taggedSmi(1)).toBe("0x00000002");
    expect(taggedSmi(-1)).toBe("0xfffffffe");
    expect(taggedSmi(0)).toBe("0x00000000");
  });
  it("throws for a non-Smi (programmer error)", () => {
    expect(() => taggedSmi(1.5)).toThrow(RangeError);
  });
});
