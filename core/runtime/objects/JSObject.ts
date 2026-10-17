import { TheHole, isTheHole, type TheHoleValue } from "../values/TheHole";
import type { JSValue } from "../values/JSValue";
import { generalizeElementsKind } from "./ElementsKind";
import { HeapObject } from "./HeapObject";
import { PropertyStorage } from "./PropertyStorage";
import type { TransitionTree } from "./TransitionTree";
import type { PropertyAttributes, V8Map } from "./V8Map";
import type { ObjectId } from "@/core/shared/ids";

/** `JSObject::kMaxGap`: a write this far past the capacity makes the elements a dictionary. */
export const ELEMENTS_MAX_GAP = 1024;

/**
 * An object's indexed properties. Fast mode is a dense vector with holes; dictionary mode is a
 * sparse table. `length` is the vector length in fast mode (for an array, the `length` property);
 * in dictionary mode it is kept separately, so `a.length = 2**32 - 1` costs nothing.
 */
export class ElementsStore {
  dense: (JSValue | TheHoleValue)[] = [];
  dictionary: Map<number, JSValue> | undefined;
  length = 0;
}

export interface NamedEntry {
  readonly value: JSValue;
  readonly attributes: PropertyAttributes;
}

/**
 * V8's JSObject: a Map (hidden class), named properties, indexed elements, and a prototype. The
 * prototype lives on the object rather than in the Map (see TransitionTree). The methods here are
 * the storage layer only; the spec operations (validation, prototype walks) are in spec/objectOps.
 */
export class JSObject extends HeapObject {
  map: V8Map;
  prototype: JSObject | null;
  readonly properties = new PropertyStorage();
  readonly elements = new ElementsStore();

  constructor(id: ObjectId, map: V8Map, prototype: JSObject | null) {
    super(id);
    this.map = map;
    this.prototype = prototype;
  }

  get hasFastProperties(): boolean {
    return !this.map.isDictionary;
  }

  // ---- named properties ----

  getOwnNamed(key: string): NamedEntry | undefined {
    if (this.map.isDictionary) return this.properties.dictionary?.get(key);
    const index = this.map.indexOf(key);
    const descriptor = this.map.descriptors[index];
    if (!descriptor) return undefined;
    return { value: this.properties.fast[index], attributes: descriptor.attributes };
  }

  namedKeys(): string[] {
    if (this.map.isDictionary) return [...(this.properties.dictionary?.keys() ?? [])];
    return this.map.descriptors.map((d) => d.key);
  }

  /** Adds `key` or overwrites it; the caller has already validated the change. */
  putNamed(maps: TransitionTree, key: string, value: JSValue, attributes: PropertyAttributes): void {
    if (!this.map.isDictionary) {
      const index = this.map.indexOf(key);
      const existing = this.map.descriptors[index];
      if (!existing) {
        this.map = maps.addProperty(this.map, key, value, attributes);
        this.properties.fast.push(value);
        return;
      }
      if (sameAttributes(existing.attributes, attributes)) {
        // Storing into a field: V8 migrates a deprecated Map first, then generalizes the field.
        this.map = maps.generalizeField(this.map, index, value);
        this.properties.fast[index] = value;
        return;
      }
      this.#normalize(maps);
    }
    this.properties.dictionary?.set(key, { value, attributes });
  }

  /** `JSObject::DeleteProperty` on a configurable property: leaves fast mode (fixture maps-same-shape-vs-order). */
  removeNamed(maps: TransitionTree, key: string): void {
    if (!this.map.isDictionary) this.#normalize(maps);
    this.properties.dictionary?.delete(key);
  }

  #normalize(maps: TransitionTree): void {
    this.properties.toDictionary(this.map.descriptors);
    this.map = maps.normalize(this.map);
  }

  // ---- elements ----

  /** The element at `index`, or `TheHole` when there is none. */
  getOwnElement(index: number): JSValue | TheHoleValue {
    const e = this.elements;
    if (e.dictionary) return e.dictionary.has(index) ? e.dictionary.get(index) : TheHole;
    return index < e.dense.length ? (e.dense[index] ?? TheHole) : TheHole;
  }

  elementIndices(): number[] {
    const e = this.elements;
    if (e.dictionary) return [...e.dictionary.keys()].sort((a, b) => a - b);
    const out: number[] = [];
    e.dense.forEach((v, i) => {
      if (v !== TheHole) out.push(i);
    });
    return out;
  }

  /** `ElementsAccessor::Set`: grows the vector, generalizes the elements kind, or goes sparse. */
  putElement(maps: TransitionTree, index: number, value: JSValue): void {
    const e = this.elements;
    if (!e.dictionary && index >= e.dense.length + ELEMENTS_MAX_GAP) this.convertElementsToDictionary(maps);
    if (e.dictionary) {
      e.dictionary.set(index, value);
      if (index >= e.length) e.length = index + 1;
      return;
    }
    let kind = generalizeElementsKind(this.map.elementsKind, value);
    if (index > e.dense.length) {
      kind = generalizeElementsKind(kind, "hole");
      while (e.dense.length < index) e.dense.push(TheHole);
    }
    e.dense[index] = value;
    e.length = e.dense.length;
    this.map = maps.withElementsKind(this.map, kind);
  }

  removeElement(maps: TransitionTree, index: number): void {
    const e = this.elements;
    if (e.dictionary) {
      e.dictionary.delete(index);
      return;
    }
    if (index >= e.dense.length || e.dense[index] === TheHole) return;
    e.dense[index] = TheHole;
    this.map = maps.withElementsKind(this.map, generalizeElementsKind(this.map.elementsKind, "hole"));
  }

  /** `JSObject::NormalizeElements`. Keeps `length`. */
  convertElementsToDictionary(maps: TransitionTree): void {
    const e = this.elements;
    if (e.dictionary) return;
    const table = new Map<number, JSValue>();
    e.dense.forEach((v, i) => {
      if (!isTheHole(v)) table.set(i, v);
    });
    e.dictionary = table;
    e.dense = [];
    this.map = maps.withElementsKind(this.map, "DICTIONARY_ELEMENTS");
  }
}

function sameAttributes(a: PropertyAttributes, b: PropertyAttributes): boolean {
  return a.writable === b.writable && a.enumerable === b.enumerable && a.configurable === b.configurable;
}
