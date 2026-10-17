import { describe, expect, it } from "vitest";
import { normal, thrown } from "@/core/interpreter/Completion";
import {
  Add,
  BitwiseAnd,
  BitwiseNot,
  BitwiseOr,
  BitwiseXor,
  Div,
  Exp,
  Mod,
  Mul,
  Negate,
  ShiftLeft,
  ShiftRight,
  ShiftRightLogical,
  Sub,
} from "./operators";
import { specTestWorld } from "./specTestWorld";

describe("Add", () => {
  const { realm, convertible } = specTestWorld();
  it("concatenates when either primitive is a string", () => {
    expect(Add(realm, 1, "2")).toEqual(normal("12"));
    expect(Add(realm, "1", 2)).toEqual(normal("12"));
    expect(Add(realm, null, "x")).toEqual(normal("nullx"));
  });
  it("adds numerically otherwise", () => {
    expect(Add(realm, true, 1)).toEqual(normal(2));
    expect(Add(realm, undefined, 1)).toEqual(normal(NaN));
    expect(Add(realm, null, 1)).toEqual(normal(1));
  });
  it("uses the default hint, so valueOf wins over toString", () => {
    const o = convertible(normal(42), normal("text"));
    expect(Add(realm, o, 1)).toEqual(normal(43));
    expect(Add(realm, o, "")).toEqual(normal("42"));
  });
  it("converts left before right and propagates a throw", () => {
    expect(Add(realm, convertible(thrown("l")), convertible(thrown("r")))).toEqual(thrown("l"));
  });
});

describe("numeric operators", () => {
  const { realm } = specTestWorld();
  it("convert both operands with ToNumeric", () => {
    expect(Sub(realm, "3", 1)).toEqual(normal(2));
    expect(Mul(realm, "5", "2")).toEqual(normal(10));
    expect(Sub(realm, "a", 1)).toEqual(normal(NaN));
    expect(Div(realm, 1, 0)).toEqual(normal(Infinity));
    expect(Mod(realm, -10, 3)).toEqual(normal(-1));
    expect(Mod(realm, 5.5, 2)).toEqual(normal(1.5));
  });
  it("keeps the sign of zero", () => {
    expect(Object.is((Mul(realm, 0, -1) as { value: number }).value, -0)).toBe(true);
    expect(Object.is((Negate(realm, 0) as { value: number }).value, -0)).toBe(true);
  });
  it("Exp follows Number::exponentiate", () => {
    expect(Exp(realm, 2, 10)).toEqual(normal(1024));
    expect(Exp(realm, 1, Infinity)).toEqual(normal(NaN));
    expect(Exp(realm, NaN, 0)).toEqual(normal(1));
    expect(Exp(realm, 2, 0.5)).toEqual(normal(Math.SQRT2));
  });
});

describe("bitwise and shift operators", () => {
  const { realm } = specTestWorld();
  it("work on Int32 and mask the shift count to 5 bits", () => {
    expect(BitwiseAnd(realm, 5, 3)).toEqual(normal(1));
    expect(BitwiseOr(realm, 5, 3)).toEqual(normal(7));
    expect(BitwiseXor(realm, 5, 3)).toEqual(normal(6));
    expect(BitwiseNot(realm, 5)).toEqual(normal(-6));
    expect(ShiftLeft(realm, 1, 31)).toEqual(normal(-(2 ** 31)));
    expect(ShiftLeft(realm, 1, 32)).toEqual(normal(1));
    expect(ShiftRight(realm, -8, 1)).toEqual(normal(-4));
    expect(ShiftRightLogical(realm, -1, 0)).toEqual(normal(4294967295));
    expect(BitwiseOr(realm, 2 ** 32 + 1, 0)).toEqual(normal(1));
  });
});
