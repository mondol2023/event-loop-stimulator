import type { BinaryExpression, Expression, UnaryExpression } from "estree";

// What V8's parser does to an expression before the bytecode generator sees it: literals combined
// by `-`, `+`, `~`, `!` and the arithmetic and bitwise operators become one literal. Comparisons,
// equality, `typeof`, `void` and `+"1"` are left for the generator, so they are left here too.

export type LiteralValue =
  | { readonly kind: "number"; readonly value: number }
  /** `folded` is a concatenation: V8 keeps it as a cons string, not an internalized one. */
  | { readonly kind: "string"; readonly value: string; readonly folded: boolean }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "null" }
  | { readonly kind: "bigint"; readonly text: string };

/** A 31/32-bit integer the interpreter can load with `LdaSmi` (-0 is a HeapNumber). */
export function isSmi(value: number): boolean {
  return Number.isInteger(value) && !Object.is(value, -0) && value >= -2147483648 && value <= 2147483647;
}

export function literalOf(node: Expression): LiteralValue | undefined {
  switch (node.type) {
    case "Literal": {
      if ("regex" in node && node.regex) return undefined;
      if ("bigint" in node && typeof node.bigint === "string") return { kind: "bigint", text: node.bigint };
      const value = node.value;
      if (typeof value === "number") return { kind: "number", value };
      if (typeof value === "string") return { kind: "string", value, folded: false };
      if (typeof value === "boolean") return { kind: "boolean", value };
      if (value === null) return { kind: "null" };
      return undefined;
    }
    case "TemplateLiteral": {
      const only = node.quasis[0];
      if (node.expressions.length > 0 || node.quasis.length !== 1 || !only) return undefined;
      return { kind: "string", value: only.value.cooked ?? "", folded: false };
    }
    case "UnaryExpression":
      return foldUnary(node);
    case "BinaryExpression":
      return foldBinary(node);
    default:
      return undefined;
  }
}

/** The truthiness of an expression V8 can see through at parse time; `undefined` when it depends on a run. */
export function toBooleanOf(node: Expression): boolean | undefined {
  const literal = literalOf(node);
  if (!literal) return undefined;
  switch (literal.kind) {
    case "number":
      return literal.value !== 0 && !Number.isNaN(literal.value);
    case "string":
      return literal.value.length > 0;
    case "boolean":
      return literal.value;
    case "null":
      return false;
    case "bigint":
      return BigInt(literal.text) !== 0n;
  }
}

function foldUnary(node: UnaryExpression): LiteralValue | undefined {
  const operand = literalOf(node.argument);
  if (!operand) return undefined;
  if (node.operator === "!") return { kind: "boolean", value: !toBooleanOf(node.argument) };
  if (operand.kind !== "number") return undefined;
  switch (node.operator) {
    case "-":
      return { kind: "number", value: -operand.value };
    case "+":
      return { kind: "number", value: operand.value };
    case "~":
      return { kind: "number", value: ~operand.value };
    default:
      return undefined;
  }
}

function foldBinary(node: BinaryExpression): LiteralValue | undefined {
  if (node.left.type === "PrivateIdentifier") return undefined;
  const left = literalOf(node.left);
  const right = literalOf(node.right);
  if (!left || !right) return undefined;
  if (left.kind === "string" && right.kind === "string") {
    return node.operator === "+" ? { kind: "string", value: left.value + right.value, folded: true } : undefined;
  }
  if (left.kind !== "number" || right.kind !== "number") return undefined;
  const a = left.value;
  const b = right.value;
  switch (node.operator) {
    case "+":
      return { kind: "number", value: a + b };
    case "-":
      return { kind: "number", value: a - b };
    case "*":
      return { kind: "number", value: a * b };
    case "/":
      return { kind: "number", value: a / b };
    case "%":
      return { kind: "number", value: a % b };
    case "**":
      return { kind: "number", value: a ** b };
    case "|":
      return { kind: "number", value: a | b };
    case "&":
      return { kind: "number", value: a & b };
    case "^":
      return { kind: "number", value: a ^ b };
    case "<<":
      return { kind: "number", value: a << b };
    case ">>":
      return { kind: "number", value: a >> b };
    case ">>>":
      return { kind: "number", value: a >>> b };
    default:
      return undefined;
  }
}

export type { Expression };
