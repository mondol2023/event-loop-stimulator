import { isThrow, normal } from "@/core/interpreter/Completion";
import type { JSFunction } from "../objects/JSFunction";
import type { Realm } from "../Realm";
import { ToString } from "../spec/conversions";
import type { JSValue } from "../values/JSValue";
import { thisPrimitiveValue } from "./wrappers";

// The String constructor (ECMA-262 String ( value )): ToString of the argument, "" with none, and
// for `new String(value)` a String exotic object over it. The subset has no Symbols, so the
// SymbolDescriptiveString step never applies. Of String.prototype only toString and valueOf exist.

export function installString(realm: Realm): JSFunction {
  const prototype = realm.intrinsics.stringPrototype;
  const text = (r: Realm, args: readonly JSValue[]) => (args.length === 0 ? normal("") : ToString(r, args[0]));
  const constructor = realm.nativeConstructor(
    "String",
    1,
    (r, _receiver, args) => text(r, args),
    (r, args) => {
      const value = text(r, args);
      return isThrow(value) ? value : normal(r.wrapPrimitive(value.value));
    },
  );
  realm.linkConstructor(constructor, prototype);
  for (const name of ["toString", "valueOf"]) {
    realm.defineMethod(prototype, name, 0, (r, receiver) => thisPrimitiveValue(r, receiver, "string", `String.prototype.${name}`));
  }
  return constructor;
}
