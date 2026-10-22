import { isThrow, normal } from "@/core/interpreter/Completion";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import type { JSFunction } from "../objects/JSFunction";
import type { Realm } from "../Realm";
import { ToNumeric } from "../spec/conversions";
import type { JSValue } from "../values/JSValue";
import { thisPrimitiveValue } from "./wrappers";

// The Number constructor (ECMA-262 Number ( value )): ToNumeric of the argument, +0 with none; the
// subset has no BigInt, so that is ToNumber. `new Number(value)` wraps it. Of Number.prototype only
// toString and valueOf exist, and toString only for radix 10 (other radixes are not modeled).

export function installNumber(realm: Realm): JSFunction {
  const prototype = realm.intrinsics.numberPrototype;
  const value = (r: Realm, args: readonly JSValue[]) => (args.length === 0 ? normal(0) : ToNumeric(r, args[0]));
  const constructor = realm.nativeConstructor(
    "Number",
    1,
    (r, _receiver, args) => value(r, args),
    (r, args) => {
      const n = value(r, args);
      return isThrow(n) ? n : normal(r.wrapPrimitive(n.value));
    },
  );
  realm.linkConstructor(constructor, prototype);
  realm.defineMethod(prototype, "toString", 1, (r, receiver, args) => {
    const n = thisPrimitiveValue(r, receiver, "number", "Number.prototype.toString");
    if (isThrow(n)) return n;
    const radix = args[0];
    if (radix !== undefined && radix !== 10) {
      throw new SimulationHalt({ kind: "unsupported", reason: "Number.prototype.toString with a radix (only radix 10 is modeled)" });
    }
    return normal(String(n.value));
  });
  realm.defineMethod(prototype, "valueOf", 0, (r, receiver) => thisPrimitiveValue(r, receiver, "number", "Number.prototype.valueOf"));
  return constructor;
}
