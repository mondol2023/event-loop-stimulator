import type { JSValue } from "../values/JSValue";
import type { FieldDescriptor, PropertyAttributes } from "./V8Map";

export interface DictionaryEntry {
  value: JSValue;
  attributes: PropertyAttributes;
}

/**
 * Where an object keeps its named properties. In fast mode `fast[i]` is the value of the Map's
 * descriptor `i` (the Map says whether the field is in-object or in the backing store). In
 * dictionary mode (`NameDictionary`) the object owns an insertion-ordered table; the host `Map`
 * keeps insertion order, and re-inserting a deleted key goes last, as the spec's key order needs.
 */
export class PropertyStorage {
  fast: JSValue[] = [];
  dictionary: Map<string, DictionaryEntry> | undefined;

  /** `JSObject::NormalizeProperties`: copy the fast fields into a dictionary, keeping their order. */
  toDictionary(descriptors: readonly FieldDescriptor[]): void {
    const table = new Map<string, DictionaryEntry>();
    descriptors.forEach((d, i) => {
      table.set(d.key, { value: this.fast[i], attributes: d.attributes });
    });
    this.dictionary = table;
    this.fast = [];
  }
}
