import { isThrow, normal, type Completion } from "@/core/interpreter/Completion";
import { HeapObject } from "../objects/HeapObject";
import type { JSValue } from "../values/JSValue";
import { ToNumber, ToPrimitive, type SpecRealm } from "./conversions";

// Equality and relational comparison abstract operations (ECMA-262 IsStrictlyEqual, SameValue,
// SameValueZero, IsLooselyEqual, IsLessThan). Primitive comparisons borrow the host's operators on
// values the interpreter holds (§3.3): numbers and UTF-16 strings compare bit-exactly.

export function IsStrictlyEqual(x: JSValue, y: JSValue): boolean {
  return x === y;
}

export function SameValue(x: JSValue, y: JSValue): boolean {
  return Object.is(x, y);
}

export function SameValueZero(x: JSValue, y: JSValue): boolean {
  return x === y || (Number.isNaN(x) && Number.isNaN(y));
}

function isNullish(v: JSValue): v is null | undefined {
  return v === null || v === undefined;
}

export function IsLooselyEqual(realm: SpecRealm, x: JSValue, y: JSValue): Completion<boolean> {
  const xObject = x instanceof HeapObject;
  const yObject = y instanceof HeapObject;
  if (xObject && yObject) return normal(x === y);
  if (!xObject && !yObject && typeof x === typeof y && !isNullish(x) && !isNullish(y)) return normal(x === y);
  if (isNullish(x) || isNullish(y)) return normal(isNullish(x) && isNullish(y));
  // Different types from here on, neither nullish.
  if (typeof x === "boolean") return IsLooselyEqual(realm, Number(x), y);
  if (typeof y === "boolean") return IsLooselyEqual(realm, x, Number(y));
  if (typeof x === "string" && typeof y === "number") return normal(Number(x) === y);
  if (typeof x === "number" && typeof y === "string") return normal(x === Number(y));
  if (xObject && (typeof y === "number" || typeof y === "string")) {
    const prim = ToPrimitive(realm, x, "default");
    return isThrow(prim) ? prim : IsLooselyEqual(realm, prim.value, y);
  }
  if (yObject && (typeof x === "number" || typeof x === "string")) {
    const prim = ToPrimitive(realm, y, "default");
    return isThrow(prim) ? prim : IsLooselyEqual(realm, x, prim.value);
  }
  return normal(false);
}

/**
 * IsLessThan(x, y, LeftFirst). `undefined` means "unordered" (a NaN took part). `LeftFirst` keeps
 * the evaluation order of the source operands when the operator swapped them (`>` and `<=`).
 */
export function IsLessThan(
  realm: SpecRealm,
  x: JSValue,
  y: JSValue,
  leftFirst: boolean,
): Completion<boolean | undefined> {
  let px: JSValue;
  let py: JSValue;
  if (leftFirst) {
    const a = ToPrimitive(realm, x, "number");
    if (isThrow(a)) return a;
    const b = ToPrimitive(realm, y, "number");
    if (isThrow(b)) return b;
    px = a.value;
    py = b.value;
  } else {
    const b = ToPrimitive(realm, y, "number");
    if (isThrow(b)) return b;
    const a = ToPrimitive(realm, x, "number");
    if (isThrow(a)) return a;
    px = a.value;
    py = b.value;
  }
  if (typeof px === "string" && typeof py === "string") return normal(px < py);
  const nx = ToNumber(realm, px);
  if (isThrow(nx)) return nx;
  const ny = ToNumber(realm, py);
  if (isThrow(ny)) return ny;
  if (Number.isNaN(nx.value) || Number.isNaN(ny.value)) return normal(undefined);
  return normal(nx.value < ny.value);
}

// The four relational operators over IsLessThan (the semantics of Ignition's Test{LessThan,...}).

export function LessThan(realm: SpecRealm, x: JSValue, y: JSValue): Completion<boolean> {
  const r = IsLessThan(realm, x, y, true);
  return isThrow(r) ? r : normal(r.value === true);
}

export function GreaterThan(realm: SpecRealm, x: JSValue, y: JSValue): Completion<boolean> {
  const r = IsLessThan(realm, y, x, false);
  return isThrow(r) ? r : normal(r.value === true);
}

export function LessThanOrEqual(realm: SpecRealm, x: JSValue, y: JSValue): Completion<boolean> {
  const r = IsLessThan(realm, y, x, false);
  return isThrow(r) ? r : normal(r.value === false);
}

export function GreaterThanOrEqual(realm: SpecRealm, x: JSValue, y: JSValue): Completion<boolean> {
  const r = IsLessThan(realm, x, y, true);
  return isThrow(r) ? r : normal(r.value === false);
}
