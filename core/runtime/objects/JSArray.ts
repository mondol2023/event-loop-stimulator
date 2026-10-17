import type { ObjectId } from "@/core/shared/ids";
import { TheHole, isTheHole, type TheHoleValue } from "../values/TheHole";
import type { JSValue } from "../values/JSValue";
import { type ElementsKind, generalizeElementsKind } from "./ElementsKind";
import { ELEMENTS_MAX_GAP, JSObject } from "./JSObject";
import type { TransitionTree } from "./TransitionTree";

/** Array exotic object. `length` is virtual: the spec operations report it as an own data property. */
export class JSArray extends JSObject {
  /** An array whose elements kind is what the literal's values need (`CreateArrayLiteral`). */
  static fromElements(
    id: ObjectId,
    maps: TransitionTree,
    prototype: JSObject | null,
    values: readonly (JSValue | TheHoleValue)[],
  ): JSArray {
    let kind: ElementsKind = "PACKED_SMI_ELEMENTS";
    for (const v of values) kind = generalizeElementsKind(kind, isTheHole(v) ? "hole" : v);
    const array = new JSArray(id, maps.rootFor("array", 0, kind), prototype);
    array.elements.dense = [...values];
    array.elements.length = values.length;
    return array;
  }

  get length(): number {
    return this.elements.length;
  }

  /** `ArraySetLength` for a valid uint32 length. Shrinking keeps the elements kind. */
  setLength(maps: TransitionTree, length: number): void {
    const e = this.elements;
    if (length === e.length) return;
    if (e.dictionary) {
      if (length < e.length) for (const index of [...e.dictionary.keys()]) if (index >= length) e.dictionary.delete(index);
      e.length = length;
      return;
    }
    if (length < e.dense.length) {
      e.dense.length = length;
      e.length = length;
      return;
    }
    if (length - e.dense.length >= ELEMENTS_MAX_GAP) {
      this.convertElementsToDictionary(maps);
      e.length = length;
      return;
    }
    while (e.dense.length < length) e.dense.push(TheHole);
    e.length = length;
    this.map = maps.withElementsKind(this.map, generalizeElementsKind(this.map.elementsKind, "hole"));
  }
}
