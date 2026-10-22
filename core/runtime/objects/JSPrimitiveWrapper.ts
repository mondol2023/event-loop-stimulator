import type { ObjectId } from "@/core/shared/ids";
import { JSObject } from "./JSObject";
import type { V8Map } from "./V8Map";

/**
 * V8's JSPrimitiveWrapper (src/objects/js-objects.h): the object `ToObject` makes of a string,
 * number or boolean, and `new String(...)` and friends. `value` is the [[StringData]],
 * [[NumberData]] or [[BooleanData]] slot. A string wrapper's index keys and `length` are virtual
 * (String exotic objects), reported by the spec operations in spec/objectOps.
 */
export class JSPrimitiveWrapper extends JSObject {
  readonly value: string | number | boolean;

  constructor(id: ObjectId, map: V8Map, prototype: JSObject | null, value: string | number | boolean) {
    super(id, map, prototype);
    this.value = value;
  }
}
