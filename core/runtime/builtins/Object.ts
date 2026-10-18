import { normal } from "@/core/interpreter/Completion";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { formatMessage } from "../messages";
import { JSObject } from "../objects/JSObject";
import type { Realm } from "../Realm";
import { OrdinaryGetOwnProperty, OrdinaryOwnPropertyKeys } from "../spec/objectOps";

// Object.keys (ECMA-262 Object.keys, EnumerableOwnProperties with kind key): the enumerable own
// string keys in OrdinaryOwnPropertyKeys order. Primitives other than strings are wrapper objects
// with no own enumerable keys.

export function installObject(realm: Realm, objectConstructor: JSObject): void {
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
