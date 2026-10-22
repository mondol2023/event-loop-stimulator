import { type Completion, normal } from "@/core/interpreter/Completion";
import { formatMessage } from "../messages";
import { JSPrimitiveWrapper } from "../objects/JSPrimitiveWrapper";
import type { Realm } from "../Realm";
import type { JSValue } from "../values/JSValue";

// thisStringValue, thisNumberValue and thisBooleanValue (ECMA-262 String.prototype.valueOf and
// friends): the primitive a method of a wrapper prototype works on, from a primitive receiver or
// from a wrapper object's [[StringData]], [[NumberData]] or [[BooleanData]].

type PrimitiveType = "string" | "number" | "boolean";
type PrimitiveOf<T extends PrimitiveType> = T extends "string" ? string : T extends "number" ? number : boolean;

const TYPE_NAME: Readonly<Record<PrimitiveType, string>> = { string: "String", number: "Number", boolean: "Boolean" };

export function thisPrimitiveValue<T extends PrimitiveType>(realm: Realm, receiver: JSValue, type: T, method: string): Completion<PrimitiveOf<T>> {
  if (typeof receiver === type) return normal(receiver as PrimitiveOf<T>);
  if (receiver instanceof JSPrimitiveWrapper && typeof receiver.value === type) return normal(receiver.value as PrimitiveOf<T>);
  return realm.throwTypeError(formatMessage("kNotGeneric", method, TYPE_NAME[type]));
}
