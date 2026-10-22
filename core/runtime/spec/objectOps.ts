import { LIMITS } from "@/core/shared/limits";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { JSArray } from "../objects/JSArray";
import type { JSObject } from "../objects/JSObject";
import { JSPrimitiveWrapper } from "../objects/JSPrimitiveWrapper";
import type { TransitionTree } from "../objects/TransitionTree";
import type { PropertyAttributes } from "../objects/V8Map";
import type { JSValue } from "../values/JSValue";
import { isTheHole } from "../values/TheHole";

// The ordinary object internal methods (ECMA-262 OrdinaryGetOwnProperty, OrdinaryDefineOwnProperty,
// OrdinaryGet, OrdinarySet, OrdinaryDelete, OrdinaryOwnPropertyKeys) plus the array exotic parts
// the subset reaches (`length`, index keys). Data properties only: accessors, symbols and
// non-extensible objects are not in the subset yet. Property keys are strings.

export interface ObjectOpsContext {
  readonly maps: TransitionTree;
}

export interface DataPropertyDescriptor extends PropertyAttributes {
  readonly value: JSValue;
}

/** A property descriptor with absent fields, as `Object.defineProperty` and the spec pass them. */
export interface PartialPropertyDescriptor {
  readonly value?: JSValue;
  readonly writable?: boolean;
  readonly enumerable?: boolean;
  readonly configurable?: boolean;
}

const ELEMENT_ATTRIBUTES: PropertyAttributes = { writable: true, enumerable: true, configurable: true };
const LENGTH_ATTRIBUTES: PropertyAttributes = { writable: true, enumerable: false, configurable: false };
const STRING_LENGTH_ATTRIBUTES: PropertyAttributes = { writable: false, enumerable: false, configurable: false };
const STRING_INDEX_ATTRIBUTES: PropertyAttributes = { writable: false, enumerable: true, configurable: false };
const MAX_ARRAY_INDEX = 4294967294;
const CANONICAL_INDEX = /^(?:0|[1-9][0-9]*)$/;

/** The array index a property key denotes (a canonical numeral below 2**32 - 1), or `undefined`. */
export function toArrayIndex(key: string): number | undefined {
  if (!CANONICAL_INDEX.test(key)) return undefined;
  const n = Number(key);
  return n <= MAX_ARRAY_INDEX ? n : undefined;
}

function unsupportedElementAttributes(): never {
  throw new SimulationHalt({ kind: "unsupported", reason: "element property with non-default attributes" });
}

/** StringGetOwnProperty: the index keys and `length` of a String exotic object. */
function stringGetOwnProperty(obj: JSObject, key: string, index: number | undefined): DataPropertyDescriptor | undefined {
  if (!(obj instanceof JSPrimitiveWrapper) || typeof obj.value !== "string") return undefined;
  if (key === "length") return { value: obj.value.length, ...STRING_LENGTH_ATTRIBUTES };
  if (index === undefined || index >= obj.value.length) return undefined;
  return { value: obj.value.charAt(index), ...STRING_INDEX_ATTRIBUTES };
}

export function OrdinaryGetOwnProperty(obj: JSObject, key: string): DataPropertyDescriptor | undefined {
  const index = toArrayIndex(key);
  if (obj instanceof JSPrimitiveWrapper) {
    const exotic = stringGetOwnProperty(obj, key, index);
    if (exotic) return exotic;
  }
  if (index !== undefined) {
    const value = obj.getOwnElement(index);
    return isTheHole(value) ? undefined : { value, ...ELEMENT_ATTRIBUTES };
  }
  if (obj instanceof JSArray && key === "length") return { value: obj.length, ...LENGTH_ATTRIBUTES };
  const entry = obj.getOwnNamed(key);
  return entry && { value: entry.value, ...entry.attributes };
}

/** ValidateAndApplyPropertyDescriptor for data descriptors on an extensible object. */
export function OrdinaryDefineOwnProperty(
  ctx: ObjectOpsContext,
  obj: JSObject,
  key: string,
  desc: PartialPropertyDescriptor,
): boolean {
  const current = OrdinaryGetOwnProperty(obj, key);
  // A string wrapper's virtual properties are read-only and non-configurable: only a no-op redefinition is valid.
  if (current && obj instanceof JSPrimitiveWrapper && stringGetOwnProperty(obj, key, toArrayIndex(key))) {
    if (desc.configurable === true || desc.writable === true) return false;
    if (desc.enumerable !== undefined && desc.enumerable !== current.enumerable) return false;
    return !("value" in desc) || Object.is(desc.value, current.value);
  }
  if (!current) {
    const attributes = {
      writable: desc.writable ?? false,
      enumerable: desc.enumerable ?? false,
      configurable: desc.configurable ?? false,
    };
    store(ctx, obj, key, desc.value, attributes);
    return true;
  }
  if (!current.configurable) {
    if (desc.configurable === true) return false;
    if (desc.enumerable !== undefined && desc.enumerable !== current.enumerable) return false;
    if (!current.writable) {
      if (desc.writable === true) return false;
      if ("value" in desc && !Object.is(desc.value, current.value)) return false;
    }
  }
  const attributes = {
    writable: desc.writable ?? current.writable,
    enumerable: desc.enumerable ?? current.enumerable,
    configurable: desc.configurable ?? current.configurable,
  };
  store(ctx, obj, key, "value" in desc ? desc.value : current.value, attributes);
  return true;
}

function store(ctx: ObjectOpsContext, obj: JSObject, key: string, value: JSValue, attributes: PropertyAttributes): void {
  const index = toArrayIndex(key);
  if (index !== undefined) {
    if (!(attributes.writable && attributes.enumerable && attributes.configurable)) unsupportedElementAttributes();
    obj.putElement(ctx.maps, index, value);
    return;
  }
  if (obj instanceof JSArray && key === "length") {
    if (!attributes.writable) {
      throw new SimulationHalt({ kind: "unsupported", reason: "non-writable array length" });
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4294967295) {
      throw new Error("ArraySetLength needs a valid uint32 (the caller throws RangeError first)");
    }
    obj.setLength(ctx.maps, value);
    return;
  }
  obj.putNamed(ctx.maps, key, value, attributes);
}

/** HasProperty (OrdinaryHasProperty): the key is an own property of `obj` or of something on its prototype chain. */
export function HasProperty(obj: JSObject, key: string): boolean {
  for (let o: JSObject | null = obj; o !== null; o = o.prototype) {
    if (OrdinaryGetOwnProperty(o, key)) return true;
  }
  return false;
}

export function OrdinaryGet(obj: JSObject, key: string): JSValue {
  for (let o: JSObject | null = obj; o !== null; o = o.prototype) {
    const desc = OrdinaryGetOwnProperty(o, key);
    if (desc) return desc.value;
  }
  return undefined;
}

export function OrdinarySet(
  ctx: ObjectOpsContext,
  obj: JSObject,
  key: string,
  value: JSValue,
  receiver: JSObject = obj,
): boolean {
  const own = OrdinaryGetOwnProperty(obj, key);
  if (!own) {
    if (obj.prototype !== null) return OrdinarySet(ctx, obj.prototype, key, value, receiver);
    return createOrUpdateOnReceiver(ctx, receiver, key, value);
  }
  if (!own.writable) return false;
  return createOrUpdateOnReceiver(ctx, receiver, key, value);
}

function createOrUpdateOnReceiver(ctx: ObjectOpsContext, receiver: JSObject, key: string, value: JSValue): boolean {
  const existing = OrdinaryGetOwnProperty(receiver, key);
  if (existing) {
    if (!existing.writable) return false;
    return OrdinaryDefineOwnProperty(ctx, receiver, key, { value });
  }
  return OrdinaryDefineOwnProperty(ctx, receiver, key, { value, ...ELEMENT_ATTRIBUTES });
}

export function OrdinaryDelete(ctx: ObjectOpsContext, obj: JSObject, key: string): boolean {
  const desc = OrdinaryGetOwnProperty(obj, key);
  if (!desc) return true;
  if (!desc.configurable) return false;
  const index = toArrayIndex(key);
  if (index !== undefined) obj.removeElement(ctx.maps, index);
  else obj.removeNamed(ctx.maps, key);
  return true;
}

/** Integer indices ascending, then string keys in insertion order (an array's `length` comes first). */
export function OrdinaryOwnPropertyKeys(obj: JSObject): string[] {
  const keys: string[] = [];
  if (obj instanceof JSPrimitiveWrapper && typeof obj.value === "string") {
    // StringExoticObject [[OwnPropertyKeys]]: the string's indices first, `length` after the other indices.
    // A loop, not a spread: a long string would overflow the host stack.
    if (obj.value.length > LIMITS.work) throw new SimulationHalt({ kind: "limit", limit: "work" });
    for (let i = 0; i < obj.value.length; i++) keys.push(String(i));
    for (const i of obj.elementIndices()) keys.push(String(i));
    keys.push("length");
  } else {
    for (const i of obj.elementIndices()) keys.push(String(i));
  }
  if (obj instanceof JSArray) keys.push("length");
  keys.push(...obj.namedKeys());
  return keys;
}
