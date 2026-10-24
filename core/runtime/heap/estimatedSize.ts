import type { HeapObject } from "../objects/HeapObject";
import { JSArray } from "../objects/JSArray";
import { JSFunction } from "../objects/JSFunction";
import { JSGeneratorObject } from "../objects/JSGeneratorObject";
import { JSHostObject } from "../objects/JSHostObject";
import { JSObject } from "../objects/JSObject";
import { JSPromise } from "../objects/JSPromise";

// Instance sizes for the modeled heap, from V8's layouts, as an illustrative model (the pinned build has no pointer compression; ADR-039) (a tagged value
// is 4 bytes, objects are 8-aligned). Illustrative: they decide when the modeled generations fill,
// never what a program does.

const TAGGED = 4;
const JS_OBJECT_HEADER = 3 * TAGGED; // map, properties, elements
const FIXED_ARRAY_HEADER = 2 * TAGGED; // map, length
const DICTIONARY_ENTRY = 3 * TAGGED; // key, value, details

const align = (bytes: number): number => Math.ceil(bytes / 8) * 8;

/** The estimated size of `object` and the backing stores it owns, in bytes. */
export function estimatedSize(object: HeapObject): number {
  if (!(object instanceof JSObject)) return align(JS_OBJECT_HEADER);
  let size = JS_OBJECT_HEADER;
  if (object.map.isDictionary) {
    size += FIXED_ARRAY_HEADER + (object.properties.dictionary?.size ?? 0) * DICTIONARY_ENTRY;
  } else {
    size += object.map.inObjectCapacity * TAGGED;
    const outOfObject = object.properties.fast.length - object.map.inObjectCapacity;
    if (outOfObject > 0) size += FIXED_ARRAY_HEADER + outOfObject * TAGGED;
  }
  if (object.elements.dictionary) size += FIXED_ARRAY_HEADER + object.elements.dictionary.size * DICTIONARY_ENTRY;
  else if (object.elements.dense.length > 0) size += FIXED_ARRAY_HEADER + object.elements.dense.length * TAGGED;
  if (object instanceof JSArray) size += TAGGED; // length
  else if (object instanceof JSFunction) size += 4 * TAGGED; // shared info, context, feedback cell, code
  else if (object instanceof JSPromise) size += 2 * TAGGED; // reactions or result, flags
  else if (object instanceof JSGeneratorObject) size += 8 * TAGGED + object.registers.length * TAGGED;
  else if (object instanceof JSHostObject) size += 2 * TAGGED;
  return align(size);
}
