import { isThrow, normal } from "@/core/interpreter/Completion";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import type { JSFunction } from "../objects/JSFunction";
import type { Realm } from "../Realm";
import { ToString } from "../spec/conversions";

// The String constructor called as a function (ECMA-262 String ( value )): ToString of the
// argument, "" with none. The subset has no Symbols, so the SymbolDescriptiveString step never
// applies. `new String(...)` makes a wrapper object, which is not modeled.

export function installString(realm: Realm): JSFunction {
  return realm.nativeConstructor(
    "String",
    1,
    (r, _receiver, args) => {
      if (args.length === 0) return normal("");
      const text = ToString(r, args[0]);
      return isThrow(text) ? text : normal(text.value);
    },
    () => {
      throw new SimulationHalt({ kind: "unsupported", reason: "new String (String wrapper objects are not modeled)" });
    },
  );
}
