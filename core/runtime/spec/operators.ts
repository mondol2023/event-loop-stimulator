import { isThrow, normal, type Completion } from "@/core/interpreter/Completion";
import type { JSValue } from "../values/JSValue";
import { ToInt32, ToNumeric, ToPrimitive, ToString, ToUint32, type SpecRealm } from "./conversions";

// Binary and unary operators by Ignition name (ApplyStringOrNumericBinaryOperator and the unary
// numeric operators). Arithmetic on numbers is the host's IEEE-754 (§3.3). `**` uses the host
// `Math.pow` path, which §3.3 lists as approximated for non-V8 hosts; the oracle property and
// docs/FIDELITY.md carry that caveat.

export function Add(realm: SpecRealm, left: JSValue, right: JSValue): Completion {
  const lprim = ToPrimitive(realm, left, "default");
  if (isThrow(lprim)) return lprim;
  const rprim = ToPrimitive(realm, right, "default");
  if (isThrow(rprim)) return rprim;
  const l = lprim.value;
  const r = rprim.value;
  if (typeof l === "string" || typeof r === "string") {
    const ls = ToString(realm, l);
    if (isThrow(ls)) return ls;
    const rs = ToString(realm, r);
    if (isThrow(rs)) return rs;
    return normal(ls.value + rs.value);
  }
  const ln = ToNumeric(realm, l);
  if (isThrow(ln)) return ln;
  const rn = ToNumeric(realm, r);
  if (isThrow(rn)) return rn;
  return normal(ln.value + rn.value);
}

function numeric(
  realm: SpecRealm,
  left: JSValue,
  right: JSValue,
  op: (l: number, r: number) => number,
): Completion<number> {
  const l = ToNumeric(realm, left);
  if (isThrow(l)) return l;
  const r = ToNumeric(realm, right);
  if (isThrow(r)) return r;
  return normal(op(l.value, r.value));
}

export const Sub = (realm: SpecRealm, l: JSValue, r: JSValue) => numeric(realm, l, r, (a, b) => a - b);
export const Mul = (realm: SpecRealm, l: JSValue, r: JSValue) => numeric(realm, l, r, (a, b) => a * b);
export const Div = (realm: SpecRealm, l: JSValue, r: JSValue) => numeric(realm, l, r, (a, b) => a / b);
export const Mod = (realm: SpecRealm, l: JSValue, r: JSValue) => numeric(realm, l, r, (a, b) => a % b);
export const Exp = (realm: SpecRealm, l: JSValue, r: JSValue) => numeric(realm, l, r, (a, b) => a ** b);
export const BitwiseAnd = (realm: SpecRealm, l: JSValue, r: JSValue) =>
  numeric(realm, l, r, (a, b) => ToInt32(a) & ToInt32(b));
export const BitwiseOr = (realm: SpecRealm, l: JSValue, r: JSValue) =>
  numeric(realm, l, r, (a, b) => ToInt32(a) | ToInt32(b));
export const BitwiseXor = (realm: SpecRealm, l: JSValue, r: JSValue) =>
  numeric(realm, l, r, (a, b) => ToInt32(a) ^ ToInt32(b));
export const ShiftLeft = (realm: SpecRealm, l: JSValue, r: JSValue) =>
  numeric(realm, l, r, (a, b) => ToInt32(a) << (ToUint32(b) & 31));
export const ShiftRight = (realm: SpecRealm, l: JSValue, r: JSValue) =>
  numeric(realm, l, r, (a, b) => ToInt32(a) >> (ToUint32(b) & 31));
export const ShiftRightLogical = (realm: SpecRealm, l: JSValue, r: JSValue) =>
  numeric(realm, l, r, (a, b) => ToUint32(a) >>> (ToUint32(b) & 31));

export function Negate(realm: SpecRealm, v: JSValue): Completion<number> {
  const n = ToNumeric(realm, v);
  return isThrow(n) ? n : normal(-n.value);
}

export function BitwiseNot(realm: SpecRealm, v: JSValue): Completion<number> {
  const n = ToNumeric(realm, v);
  return isThrow(n) ? n : normal(~ToInt32(n.value));
}
