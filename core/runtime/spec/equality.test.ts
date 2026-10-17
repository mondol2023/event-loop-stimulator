import { describe, expect, it } from "vitest";
import { normal, thrown } from "@/core/interpreter/Completion";
import {
  GreaterThan,
  GreaterThanOrEqual,
  IsLessThan,
  IsLooselyEqual,
  IsStrictlyEqual,
  LessThan,
  LessThanOrEqual,
  SameValue,
  SameValueZero,
} from "./equality";
import { specTestWorld } from "./specTestWorld";

describe("IsStrictlyEqual, SameValue, SameValueZero", () => {
  const { object } = specTestWorld();
  it("treats NaN and the zeros as the spec says", () => {
    expect(IsStrictlyEqual(NaN, NaN)).toBe(false);
    expect(IsStrictlyEqual(0, -0)).toBe(true);
    expect(SameValue(NaN, NaN)).toBe(true);
    expect(SameValue(0, -0)).toBe(false);
    expect(SameValueZero(NaN, NaN)).toBe(true);
    expect(SameValueZero(0, -0)).toBe(true);
  });
  it("compares objects by identity and never across types", () => {
    const a = object();
    expect(IsStrictlyEqual(a, a)).toBe(true);
    expect(IsStrictlyEqual(a, object())).toBe(false);
    expect(IsStrictlyEqual(1, "1")).toBe(false);
  });
});

describe("IsLooselyEqual", () => {
  const { realm, object, convertible } = specTestWorld();
  it.each([
    [null, undefined, true],
    [null, 0, false],
    [undefined, false, false],
    [0, "", true],
    ["", "0", false],
    [false, "0", true],
    [true, 2, false],
    [NaN, NaN, false],
  ])("%j == %j is %j", (a, b, expected) => expect(IsLooselyEqual(realm, a, b)).toEqual(normal(expected)));

  it("converts an object through ToPrimitive with the default hint", () => {
    const o = convertible(normal(42), normal("text"));
    expect(IsLooselyEqual(realm, o, 42)).toEqual(normal(true));
    expect(IsLooselyEqual(realm, 42, o)).toEqual(normal(true));
    expect(IsLooselyEqual(realm, o, "text")).toEqual(normal(false));
    expect(IsLooselyEqual(realm, o, object())).toEqual(normal(false));
    expect(IsLooselyEqual(realm, o, o)).toEqual(normal(true));
  });

  it("does not convert an object compared with null or undefined", () => {
    expect(IsLooselyEqual(realm, object(), null)).toEqual(normal(false));
  });

  it("propagates a throw from ToPrimitive", () => {
    const o = convertible(thrown("boom"));
    expect(IsLooselyEqual(realm, o, 1)).toEqual(thrown("boom"));
  });
});

describe("IsLessThan", () => {
  const { realm, convertible } = specTestWorld();
  it("compares two strings by UTF-16 code units, not numerically", () => {
    expect(IsLessThan(realm, "10", "9", true)).toEqual(normal(true));
    expect(IsLessThan(realm, "\u{1F600}", "￿", true)).toEqual(normal(true));
  });
  it("compares mixed operands numerically and is undefined for NaN", () => {
    expect(IsLessThan(realm, "10", 9, true)).toEqual(normal(false));
    expect(IsLessThan(realm, "abc", 1, true)).toEqual(normal(undefined));
    expect(IsLessThan(realm, null, 1, true)).toEqual(normal(true));
  });
  it("converts left first when LeftFirst is true, right first otherwise", () => {
    // The operand converted first is the one whose throw surfaces.
    const lt = convertible(thrown("left"));
    const rt = convertible(thrown("right"));
    expect(IsLessThan(realm, lt, rt, true)).toEqual(thrown("left"));
    expect(IsLessThan(realm, lt, rt, false)).toEqual(thrown("right"));
    expect(IsLessThan(realm, convertible(normal(1)), convertible(normal(2)), true)).toEqual(normal(true));
  });
});

describe("relational operators", () => {
  const { realm } = specTestWorld();
  it("maps undefined (NaN) to false for all four", () => {
    expect(LessThan(realm, NaN, 1)).toEqual(normal(false));
    expect(GreaterThan(realm, NaN, 1)).toEqual(normal(false));
    expect(LessThanOrEqual(realm, NaN, 1)).toEqual(normal(false));
    expect(GreaterThanOrEqual(realm, NaN, 1)).toEqual(normal(false));
  });
  it("treats null >= 0 as true", () => {
    expect(GreaterThanOrEqual(realm, null, 0)).toEqual(normal(true));
    expect(LessThanOrEqual(realm, 1, 1)).toEqual(normal(true));
    expect(GreaterThan(realm, 2, 1)).toEqual(normal(true));
  });
});
