import { isThrow, normal } from "@/core/interpreter/Completion";
import { formatMessage } from "../messages";
import { JSArguments } from "../objects/JSArguments";
import { JSArray } from "../objects/JSArray";
import { JSFunction } from "../objects/JSFunction";
import { JSObject } from "../objects/JSObject";
import { JSPrimitiveWrapper } from "../objects/JSPrimitiveWrapper";
import { JSError } from "./errors";
import type { Realm } from "../Realm";
import { ToPropertyKey } from "../spec/conversions";
import { OrdinaryGetOwnProperty, OrdinaryOwnPropertyKeys } from "../spec/objectOps";

// Object.keys (ECMA-262 Object.keys, EnumerableOwnProperties with kind key): the enumerable own
// string keys in OrdinaryOwnPropertyKeys order. Primitives other than strings are wrapper objects
// with no own enumerable keys.
//
// Object.prototype.toString, valueOf and hasOwnProperty: what OrdinaryToPrimitive finds for a plain
// object, and the property check test code reaches through `obj.hasOwnProperty(key)`.

/** The builtinTag of Object.prototype.toString for the object kinds the subset has. */
function builtinTag(o: JSObject): string {
  if (o instanceof JSArray) return "Array";
  if (o instanceof JSArguments) return "Arguments";
  if (o.isCallable) return "Function";
  if (o instanceof JSError) return "Error";
  if (o instanceof JSPrimitiveWrapper) return typeof o.value === "string" ? "String" : typeof o.value === "number" ? "Number" : "Boolean";
  return "Object";
}

const PRIMITIVE_TAGS = { string: "String", number: "Number", boolean: "Boolean" } as const;

/** Own properties the object model answers elsewhere: a sloppy function's `caller`/`arguments`, an unmapped arguments' `callee`. */
function virtualOwnProperty(o: JSObject, key: string): boolean {
  if (key === "callee") return o instanceof JSArguments && o.unmapped;
  if (key !== "caller" && key !== "arguments" || !(o instanceof JSFunction)) return false;
  const code = o.code;
  return code !== undefined && !code.strict && code.constructable && code.kind === "normal";
}

export function installObject(realm: Realm, objectConstructor: JSObject): void {
  const prototype = realm.intrinsics.objectPrototype;
  realm.defineMethod(prototype, "toString", 0, (r, receiver) => {
    if (receiver === undefined) return normal("[object Undefined]");
    if (receiver === null) return normal("[object Null]");
    if (!(receiver instanceof JSObject)) return normal(`[object ${PRIMITIVE_TAGS[typeof receiver as keyof typeof PRIMITIVE_TAGS]}]`);
    const tag = r.toStringTag(receiver);
    return normal(`[object ${tag === "" ? builtinTag(receiver) : tag}]`);
  });
  realm.defineMethod(prototype, "valueOf", 0, (r, receiver) => r.toObject(receiver));
  realm.defineMethod(prototype, "hasOwnProperty", 1, (r, receiver, args) => {
    const key = ToPropertyKey(r, args[0]);
    if (isThrow(key)) return key;
    const o = r.toObject(receiver);
    if (isThrow(o)) return o;
    return normal(OrdinaryGetOwnProperty(o.value, key.value) !== undefined || virtualOwnProperty(o.value, key.value));
  });

  realm.defineMethod(objectConstructor, "keys", 1, (r, _receiver, args) => {
    const target = args[0];
    if (target === undefined || target === null) return r.throwTypeError(formatMessage("kUndefinedOrNullToObject"));
    if (typeof target === "string") {
      r.work.charge(target.length);
      return normal(r.newArray(Array.from({ length: target.length }, (_, i) => String(i))));
    }
    if (!(target instanceof JSObject)) return normal(r.newArray());
    const keys: string[] = [];
    for (const key of OrdinaryOwnPropertyKeys(target)) {
      r.work.charge();
      if (OrdinaryGetOwnProperty(target, key)?.enumerable) keys.push(key);
    }
    return normal(r.newArray(keys));
  });
}
