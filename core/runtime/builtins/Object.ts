import { normal } from "@/core/interpreter/Completion";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { formatMessage } from "../messages";
import { JSArray } from "../objects/JSArray";
import { JSObject } from "../objects/JSObject";
import { JSError } from "./errors";
import type { Realm } from "../Realm";
import { OrdinaryGetOwnProperty, OrdinaryOwnPropertyKeys } from "../spec/objectOps";

// Object.keys (ECMA-262 Object.keys, EnumerableOwnProperties with kind key): the enumerable own
// string keys in OrdinaryOwnPropertyKeys order. Primitives other than strings are wrapper objects
// with no own enumerable keys.
//
// Object.prototype.toString and valueOf: what OrdinaryToPrimitive finds for a plain object. The
// subset cannot reach them with a primitive receiver (`.call` and prototypes are excluded).

function objectReceiver(receiver: unknown, method: string): JSObject {
  if (receiver instanceof JSObject) return receiver;
  throw new SimulationHalt({ kind: "unsupported", reason: `Object.prototype.${method} on a primitive (wrapper objects are not modeled)` });
}

/** The builtinTag of Object.prototype.toString for the object kinds the subset has. */
function builtinTag(o: JSObject): string {
  if (o instanceof JSArray) return "Array";
  if (o.isCallable) return "Function";
  if (o instanceof JSError) return "Error";
  return "Object";
}

export function installObject(realm: Realm, objectConstructor: JSObject): void {
  const prototype = realm.intrinsics.objectPrototype;
  realm.defineMethod(prototype, "toString", 0, (r, receiver) => {
    const o = objectReceiver(receiver, "toString");
    const tag = r.toStringTag(o);
    return normal(`[object ${tag === "" ? builtinTag(o) : tag}]`);
  });
  realm.defineMethod(prototype, "valueOf", 0, (_r, receiver) => normal(objectReceiver(receiver, "valueOf")));

  realm.defineMethod(objectConstructor, "keys", 1, (r, _receiver, args) => {
    const target = args[0];
    if (target === undefined || target === null) return r.throwTypeError(formatMessage("kUndefinedOrNullToObject"));
    if (typeof target === "string") {
      throw new SimulationHalt({ kind: "unsupported", reason: "Object.keys of a string (String wrapper objects are not modeled)" });
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
