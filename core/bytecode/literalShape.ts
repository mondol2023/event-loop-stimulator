import type { ArrayExpression, Expression, ObjectExpression, Property } from "estree";
import { isSmi, literalOf } from "./literals";

// What V8 works out about an object or array literal before the generator emits it
// (`LiteralBoilerplateBuilder::InitDepthAndFlags`): how deeply literals nest, whether every value is
// a compile-time constant (so the whole literal is a boilerplate and needs no stores) and the
// elements kind of an array's boilerplate. The flag bits and descriptions printed in the listings
// follow from these.

export type LiteralNode = ObjectExpression | ArrayExpression;

export function isLiteralNode(node: Expression): node is LiteralNode {
  return node.type === "ObjectExpression" || node.type === "ArrayExpression";
}

/** V8's `CompileTimeValue::IsCompileTimeValue`: a literal, or an object or array literal that is itself all constants. */
export function isCompileTimeValue(node: Expression): boolean {
  if (literalOf(node)) return true;
  return isLiteralNode(node) && shapeOf(node).simple;
}

export type LiteralShape = {
  /** 1 for a literal with no literal inside it. */
  readonly depth: number;
  readonly simple: boolean;
  /** An array literal always needs an allocation site; an object does when an array is nested in it. */
  readonly needsAllocationSite: boolean;
};

export function shapeOf(node: LiteralNode): LiteralShape {
  let depth = 1;
  let simple = true;
  let needsAllocationSite = node.type === "ArrayExpression";
  const values: (Expression | null)[] = [];
  if (node.type === "ArrayExpression") {
    for (const element of node.elements) {
      if (element?.type === "SpreadElement") simple = false;
      else values.push(element);
    }
  } else {
    for (const property of node.properties) {
      if (property.type === "SpreadElement" || property.computed || property.kind !== "init" || property.method) simple = false;
      if (property.type === "Property") values.push(property.value as Expression);
    }
  }
  for (const value of values) {
    if (!value) continue;
    if (isLiteralNode(value)) {
      const nested = shapeOf(value);
      depth = Math.max(depth, nested.depth + 1);
      needsAllocationSite ||= nested.needsAllocationSite;
    }
    if (!isCompileTimeValue(value)) simple = false;
  }
  return { depth, simple, needsAllocationSite };
}

/** `CreateObjectLiteralFlags`: the literal's own flags in the low bits, the fast-clone bit above them. */
const SHALLOW = 1;
const NEEDS_ALLOCATION_SITE = 4;
const FAST_ELEMENTS = 8;
const FAST_CLONE = 32;

export function objectFlags(node: ObjectExpression): number {
  const shape = shapeOf(node);
  const shallow = shape.depth === 1;
  const fastElements = hasFastElements(node);
  let flags = 0;
  if (shallow) flags |= SHALLOW;
  if (shape.needsAllocationSite) flags |= NEEDS_ALLOCATION_SITE;
  if (fastElements) flags |= FAST_ELEMENTS;
  if (shallow && fastElements) flags |= FAST_CLONE;
  return flags;
}

export function arrayFlags(node: ArrayExpression): number {
  const shallow = shapeOf(node).depth === 1;
  return NEEDS_ALLOCATION_SITE | (shallow ? SHALLOW | FAST_CLONE : 0);
}

/** The key's text when V8 treats it as an element index (`{ 1: a }`, `{ "2": b }`), else undefined. */
export function elementIndexOf(property: Property): number | undefined {
  if (property.computed) return undefined;
  const key = property.key;
  if (key.type !== "Literal") return undefined;
  const text = typeof key.value === "number" ? String(key.value) : typeof key.value === "string" ? key.value : undefined;
  if (text === undefined || !/^(0|[1-9]\d*)$/.test(text)) return undefined;
  const index = Number(text);
  return index < 4294967295 ? index : undefined;
}

function hasFastElements(node: ObjectExpression): boolean {
  let elements = 0;
  let maxIndex = 0;
  for (const property of node.properties) {
    if (property.type !== "Property") continue;
    const index = elementIndexOf(property);
    if (index === undefined) continue;
    elements++;
    maxIndex = Math.max(maxIndex, index);
  }
  return maxIndex <= 32 || 2 * elements >= maxIndex;
}

/** The `ObjectBoilerplateDescription` a literal's constant-pool entry prints as: two slots per property. */
export function objectBoilerplateText(node: ObjectExpression): string {
  return `ObjectBoilerplateDescription[${node.properties.length * 2}]`;
}

/** The `ArrayBoilerplateDescription`: the elements kind of the constants, and a backing store of one slot per element. */
export function arrayBoilerplateText(node: ArrayExpression): string {
  let holey = false;
  let kind: "SMI_" | "DOUBLE_" | "" = "SMI_";
  for (const element of node.elements) {
    if (!element) {
      holey = true;
      continue;
    }
    if (element.type === "SpreadElement") continue;
    // A value only known at run time is a placeholder Smi in the boilerplate and widens nothing.
    if (!isCompileTimeValue(element)) continue;
    const literal = literalOf(element);
    if (literal?.kind === "number") {
      if (!isSmi(literal.value) && kind === "SMI_") kind = "DOUBLE_";
    } else {
      kind = "";
    }
  }
  const store = kind === "DOUBLE_" ? "FixedDoubleArray" : "FixedArray";
  return `ArrayBoilerplateDescription ${holey ? "HOLEY" : "PACKED"}_${kind}ELEMENTS, <${store}[${node.elements.length}]>`;
}
