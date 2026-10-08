import { parse } from "@babel/parser";
import type { Expression, ExpressionStatement } from "estree";
import { describe, expect, it } from "vitest";
import { isSmi, literalOf, toBooleanOf } from "./literals";

// What V8's parser makes of an expression before the bytecode generator sees it: it folds
// `-1`, `!x`, `1 + 2` and `"a" + "b"` of literals into one Literal. The expectations below are
// what real Node printed for the same source (see the bytecode families' micro-fixtures).

function expression(source: string): Expression {
  const file = parse(`(${source})`, { sourceType: "script", plugins: ["estree"], ranges: true });
  return (file.program.body[0] as unknown as ExpressionStatement).expression;
}

const literal = (source: string) => literalOf(expression(source));

describe("literalOf", () => {
  it("reads plain literals", () => {
    expect(literal("5")).toEqual({ kind: "number", value: 5 });
    expect(literal("'x'")).toEqual({ kind: "string", value: "x", folded: false });
    expect(literal("true")).toEqual({ kind: "boolean", value: true });
    expect(literal("null")).toEqual({ kind: "null" });
    expect(literal("10n")).toEqual({ kind: "bigint", text: "10" });
  });

  it("does not treat names, calls or regular expressions as literals", () => {
    expect(literal("undefined")).toBeUndefined();
    expect(literal("NaN")).toBeUndefined();
    expect(literal("x")).toBeUndefined();
    expect(literal("/a/g")).toBeUndefined();
    expect(literal("f()")).toBeUndefined();
  });

  it("makes a template without substitutions a string literal", () => {
    expect(literal("`abc`")).toEqual({ kind: "string", value: "abc", folded: false });
    expect(literal("`a${1}`")).toBeUndefined();
  });

  it("folds unary operators on literals", () => {
    expect(literal("-1")).toEqual({ kind: "number", value: -1 });
    expect(literal("-0")).toEqual({ kind: "number", value: -0 });
    expect(literal("-(-1)")).toEqual({ kind: "number", value: 1 });
    expect(literal("+5")).toEqual({ kind: "number", value: 5 });
    expect(literal("~5")).toEqual({ kind: "number", value: -6 });
    expect(literal("!0")).toEqual({ kind: "boolean", value: true });
    expect(literal("!'x'")).toEqual({ kind: "boolean", value: false });
    expect(literal("!null")).toEqual({ kind: "boolean", value: true });
  });

  it("leaves unary operators V8 does not fold", () => {
    expect(literal("+'1'")).toBeUndefined();
    expect(literal("-'1'")).toBeUndefined();
    expect(literal("-10n")).toBeUndefined();
    expect(literal("typeof 1")).toBeUndefined();
    expect(literal("void 0")).toBeUndefined();
  });

  it("folds arithmetic and bitwise operators on two number literals", () => {
    expect(literal("1 + 2")).toEqual({ kind: "number", value: 3 });
    expect(literal("5 % 3")).toEqual({ kind: "number", value: 2 });
    expect(literal("7 % 0")).toEqual({ kind: "number", value: NaN });
    expect(literal("2 ** 3")).toEqual({ kind: "number", value: 8 });
    expect(literal("2 ** -1")).toEqual({ kind: "number", value: 0.5 });
    expect(literal("1 / 0")).toEqual({ kind: "number", value: Infinity });
    expect(literal("1 << 3")).toEqual({ kind: "number", value: 8 });
    expect(literal("-1 >>> 0")).toEqual({ kind: "number", value: 4294967295 });
    expect(literal("6 & 3")).toEqual({ kind: "number", value: 2 });
    expect(literal("1 + 2 + 3")).toEqual({ kind: "number", value: 6 });
  });

  it("folds with double arithmetic", () => {
    expect(literal("0.1 + 0.2")).toEqual({ kind: "number", value: 0.1 + 0.2 });
  });

  it("does not fold comparisons, equality or mixed operands", () => {
    expect(literal("1 < 2")).toBeUndefined();
    expect(literal("1 == 1")).toBeUndefined();
    expect(literal("null + 1")).toBeUndefined();
    expect(literal("'a' + 1")).toBeUndefined();
    expect(literal("1 + 'a'")).toBeUndefined();
    expect(literal("1 && 2")).toBeUndefined();
  });

  it("concatenates string literals into a string that is not internalized", () => {
    expect(literal("'a' + 'b'")).toEqual({ kind: "string", value: "ab", folded: true });
    expect(literal("'a' + 'b' + 'c'")).toEqual({ kind: "string", value: "abc", folded: true });
  });
});

describe("toBooleanOf", () => {
  it("knows the truthiness of a literal only", () => {
    expect(toBooleanOf(expression("0"))).toBe(false);
    expect(toBooleanOf(expression("''"))).toBe(false);
    expect(toBooleanOf(expression("null"))).toBe(false);
    expect(toBooleanOf(expression("1"))).toBe(true);
    expect(toBooleanOf(expression("'a'"))).toBe(true);
    expect(toBooleanOf(expression("!0"))).toBe(true);
    expect(toBooleanOf(expression("0n"))).toBe(false);
    expect(toBooleanOf(expression("x"))).toBeUndefined();
    expect(toBooleanOf(expression("undefined"))).toBeUndefined();
    expect(toBooleanOf(expression("({})"))).toBeUndefined();
  });
});

describe("isSmi", () => {
  it("accepts the 32-bit integers and not minus zero", () => {
    expect(isSmi(0)).toBe(true);
    expect(isSmi(2147483647)).toBe(true);
    expect(isSmi(-2147483648)).toBe(true);
    expect(isSmi(2147483648)).toBe(false);
    expect(isSmi(0.5)).toBe(false);
    expect(isSmi(-0)).toBe(false);
    expect(isSmi(NaN)).toBe(false);
  });
});
