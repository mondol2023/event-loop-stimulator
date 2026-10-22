import type { ObjectId } from "@/core/shared/ids";
import { JSObject } from "./JSObject";
import type { V8Map } from "./V8Map";

/**
 * An arguments object (src/objects/js-objects.h JSArgumentsObject): the indexed arguments of one
 * call plus `length`. A sloppy one has `callee`; a strict (unmapped) one has a throwing `callee`
 * accessor. Mapped parameter aliasing is not modeled: the validator refuses every program that
 * reads a mapped object whose function has formal parameters.
 */
export class JSArguments extends JSObject {
  /** CreateUnmappedArguments: `callee` is the %ThrowTypeError% accessor. */
  readonly unmapped: boolean;

  constructor(id: ObjectId, map: V8Map, prototype: JSObject | null, unmapped: boolean) {
    super(id, map, prototype);
    this.unmapped = unmapped;
  }
}
