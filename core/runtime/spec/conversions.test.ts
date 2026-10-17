import { describe, expect, it } from "vitest";
import { normal, thrown } from "@/core/interpreter/Completion";
import {
  ToBoolean,
  ToInt32,
  ToNumber,
  ToNumeric,
  ToPrimitive,
  ToPropertyKey,
  ToString,
  ToUint32,
  typeofOperator,
} from "./conversions";
import { specTestWorld } from "./specTestWorld";

describe("ToNumber on primitives", () => {
  const { realm } = specTestWorld();
  it.each([
    [undefined, NaN],
    [null, 0],
    [true, 1],
    [false, 0],
    ["", 0],
    [" 12 ", 12],
    ["0x10", 16],
    ["1e3", 1000],
    ["12px", NaN],
    ["Infinity", Infinity],
    ["-0", -0],
  ])("ToNumber(%j) is %j", (input, expected) => {
    const result = ToNumber(realm, input);
    expect(result.type).toBe("normal");
    expect(Object.is((result as { value: number }).value, expected)).toBe(true);
  });
});

describe("ToString on primitives", () => {
  const { realm } = specTestWorld();
  it.each([
    [undefined, "undefined"],
    [null, "null"],
    [true, "true"],
    [-0, "0"],
    [1e21, "1e+21"],
    [1e-7, "1e-7"],
    [5e-324, "5e-324"],
    [NaN, "NaN"],
    [-Infinity, "-Infinity"],
    ["s", "s"],
  ])("ToString(%j) is %j", (input, expected) => {
    expect(ToString(realm, input)).toEqual(normal(expected));
  });
});

describe("ToBoolean", () => {
  const { object } = specTestWorld();
  it.each([
    [undefined, false],
    [null, false],
    [0, false],
    [-0, false],
    [NaN, false],
    ["", false],
    ["0", true],
    [1, true],
    [Infinity, true],
  ])("ToBoolean(%j) is %j", (input, expected) => expect(ToBoolean(input)).toBe(expected));
  it("is true for every object", () => expect(ToBoolean(object())).toBe(true));
});

describe("ToInt32 and ToUint32", () => {
  it.each([
    [2 ** 31, -(2 ** 31), 2 ** 31],
    [-1, -1, 4294967295],
    [2 ** 32 + 5, 5, 5],
    [NaN, 0, 0],
    [Infinity, 0, 0],
    [-0, 0, 0],
    [1.9, 1, 1],
    [-1.9, -1, 4294967295],
  ])("%j", (input, int32, uint32) => {
    expect(Object.is(ToInt32(input), int32)).toBe(true);
    expect(ToUint32(input)).toBe(uint32);
  });
});

describe("typeofOperator", () => {
  const { object, fn } = specTestWorld();
  it("follows the typeof table", () => {
    expect(typeofOperator(undefined)).toBe("undefined");
    expect(typeofOperator(null)).toBe("object");
    expect(typeofOperator(true)).toBe("boolean");
    expect(typeofOperator(1)).toBe("number");
    expect(typeofOperator("")).toBe("string");
    expect(typeofOperator(object())).toBe("object");
    expect(typeofOperator(fn("f", () => normal(undefined)))).toBe("function");
  });
});

describe("ToPrimitive", () => {
  it("returns primitives unchanged", () => {
    const { realm } = specTestWorld();
    expect(ToPrimitive(realm, 3, "default")).toEqual(normal(3));
  });

  it("tries valueOf first for the default and number hints, toString first for string", () => {
    const w = specTestWorld();
    const o = w.convertible(normal(42), normal("text"));
    expect(ToPrimitive(w.realm, o, "default")).toEqual(normal(42));
    expect(ToPrimitive(w.realm, o, "number")).toEqual(normal(42));
    expect(w.calls).toEqual(["valueOf", "valueOf"]);
    w.calls.length = 0;
    expect(ToPrimitive(w.realm, o, "string")).toEqual(normal("text"));
    expect(w.calls).toEqual(["toString"]);
  });

  it("falls through to the other method when the first returns an object", () => {
    const w = specTestWorld();
    const o = w.convertible(normal(w.object()), normal("fallback"));
    expect(ToPrimitive(w.realm, o, "default")).toEqual(normal("fallback"));
    expect(w.calls).toEqual(["valueOf", "toString"]);
  });

  it("skips a non-callable method", () => {
    const w = specTestWorld();
    const o = w.object({ valueOf: 1, toString: w.fn("toString", () => normal("s")) });
    expect(ToPrimitive(w.realm, o, "number")).toEqual(normal("s"));
  });

  it("propagates a throw from the method without trying the other", () => {
    const w = specTestWorld();
    const o = w.convertible(thrown("boom"), normal("never"));
    expect(ToPrimitive(w.realm, o, "default")).toEqual(thrown("boom"));
    expect(w.calls).toEqual(["valueOf"]);
  });

  it("throws a TypeError when neither method yields a primitive", () => {
    const w = specTestWorld();
    expect(ToPrimitive(w.realm, w.object(), "default")).toEqual(
      thrown("TypeError: Cannot convert object to primitive value"),
    );
  });
});

describe("conversions of objects", () => {
  it("ToNumber, ToString and ToPropertyKey call ToPrimitive with the right hint", () => {
    const w = specTestWorld();
    const o = w.convertible(normal(42), normal("text"));
    expect(ToNumber(w.realm, o)).toEqual(normal(42));
    expect(ToString(w.realm, o)).toEqual(normal("text"));
    expect(ToNumeric(w.realm, o)).toEqual(normal(42));
    expect(ToPropertyKey(w.realm, o)).toEqual(normal("text"));
    expect(ToPropertyKey(w.realm, 1.5)).toEqual(normal("1.5"));
  });

  it("ToNumber converts a primitive result that is not a number", () => {
    const w = specTestWorld();
    expect(ToNumber(w.realm, w.convertible(normal("7")))).toEqual(normal(7));
  });
});
