import { normal } from "@/core/interpreter/Completion";
import type { JSFunction } from "../objects/JSFunction";
import type { Realm } from "../Realm";
import { ToBoolean } from "../spec/conversions";
import { thisPrimitiveValue } from "./wrappers";

// The Boolean constructor (ECMA-262 Boolean ( value )): ToBoolean of the argument, `new Boolean(value)` wraps it.

export function installBoolean(realm: Realm): JSFunction {
  const prototype = realm.intrinsics.booleanPrototype;
  const constructor = realm.nativeConstructor(
    "Boolean",
    1,
    (_r, _receiver, args) => normal(ToBoolean(args[0])),
    (r, args) => normal(r.wrapPrimitive(ToBoolean(args[0]))),
  );
  realm.linkConstructor(constructor, prototype);
  realm.defineMethod(prototype, "toString", 0, (r, receiver) => {
    const b = thisPrimitiveValue(r, receiver, "boolean", "Boolean.prototype.toString");
    return b.type === "throw" ? b : normal(String(b.value));
  });
  realm.defineMethod(prototype, "valueOf", 0, (r, receiver) => thisPrimitiveValue(r, receiver, "boolean", "Boolean.prototype.valueOf"));
  return constructor;
}
