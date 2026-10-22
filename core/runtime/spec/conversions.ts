import { isThrow, normal, type Completion } from "@/core/interpreter/Completion";
import { HeapObject } from "../objects/HeapObject";
import { JSObject } from "../objects/JSObject";
import type { JSValue } from "../values/JSValue";
import { OrdinaryGet } from "./objectOps";

// Type conversion abstract operations (ECMA-262 ToPrimitive, ToBoolean, ToNumber, ToNumeric,
// ToString, ToPropertyKey, ToInt32, ToUint32). The subset has no Symbol and no BigInt, so
// ToNumeric is ToNumber and a property key is always a string. Number<->string conversion
// borrows the host's bit-exact IEEE-754 routines (§3.3); no program text is evaluated.

/** What the conversions need from the realm: calling user code and raising a TypeError. */
export interface SpecRealm {
  call(fn: HeapObject, receiver: JSValue, args: readonly JSValue[]): Completion;
  /** Completes with a thrown TypeError whose message is already formatted (V8 message-template.h). */
  throwTypeError(message: string): Completion<never>;
}

export type ToPrimitiveHint = "default" | "number" | "string";

export function typeofOperator(v: JSValue): string {
  if (v === null) return "object";
  if (v instanceof HeapObject) return v.isCallable ? "function" : "object";
  return typeof v;
}

export function ToBoolean(v: JSValue): boolean {
  if (v instanceof HeapObject) return true;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  return Boolean(v);
}

/** OrdinaryToPrimitive: valueOf then toString for "number", the reverse for "string". */
function OrdinaryToPrimitive(realm: SpecRealm, obj: HeapObject, hint: "number" | "string"): Completion {
  const names = hint === "string" ? ["toString", "valueOf"] : ["valueOf", "toString"];
  for (const name of names) {
    const method = obj instanceof JSObject ? OrdinaryGet(obj, name) : undefined;
    if (!(method instanceof HeapObject) || !method.isCallable) continue;
    const result = realm.call(method, obj, []);
    if (isThrow(result)) return result;
    if (!(result.value instanceof HeapObject)) return result;
  }
  return realm.throwTypeError("Cannot convert object to primitive value");
}

export function ToPrimitive(realm: SpecRealm, v: JSValue, hint: ToPrimitiveHint): Completion {
  if (!(v instanceof HeapObject)) return normal(v);
  // @@toPrimitive is a Symbol-keyed lookup; the subset has no Symbols, so only the ordinary path exists.
  return OrdinaryToPrimitive(realm, v, hint === "default" ? "number" : hint);
}

/** StringToNumber: the host's Number(string) is the spec's StringNumericLiteral parse. */
function stringToNumber(s: string): number {
  return Number(s);
}

function primitiveToNumber(v: Exclude<JSValue, HeapObject>): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return stringToNumber(v);
  if (v === undefined) return NaN;
  if (v === null) return 0;
  return v ? 1 : 0;
}

export function ToNumber(realm: SpecRealm, v: JSValue): Completion<number> {
  if (!(v instanceof HeapObject)) return normal(primitiveToNumber(v));
  const prim = ToPrimitive(realm, v, "number");
  if (isThrow(prim)) return prim;
  return ToNumber(realm, prim.value);
}

/** No BigInt in the subset: ToNumeric is ToNumber. */
export function ToNumeric(realm: SpecRealm, v: JSValue): Completion<number> {
  return ToNumber(realm, v);
}

export function primitiveToString(v: Exclude<JSValue, HeapObject>): string {
  return String(v);
}

export function ToString(realm: SpecRealm, v: JSValue): Completion<string> {
  if (!(v instanceof HeapObject)) return normal(primitiveToString(v));
  const prim = ToPrimitive(realm, v, "string");
  if (isThrow(prim)) return prim;
  return ToString(realm, prim.value);
}

export function ToPropertyKey(realm: SpecRealm, v: JSValue): Completion<string> {
  const key = ToPrimitive(realm, v, "string");
  if (isThrow(key)) return key;
  return ToString(realm, key.value);
}

/** Number -> Int32 / Uint32 by modular arithmetic; NaN and the infinities give 0. */
export function ToInt32(n: number): number {
  return n | 0;
}

export function ToUint32(n: number): number {
  return n >>> 0;
}
