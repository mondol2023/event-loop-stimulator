import { type Completion, isThrow, normal } from "@/core/interpreter/Completion";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { formatMessage } from "../messages";
import { JSArray } from "../objects/JSArray";
import { JSFunction } from "../objects/JSFunction";
import type { Realm } from "../Realm";
import { HasProperty, OrdinaryDefineOwnProperty, OrdinaryGet, OrdinarySet } from "../spec/objectOps";
import { ToBoolean, ToString } from "../spec/conversions";
import type { JSValue } from "../values/JSValue";
import { TheHole, type TheHoleValue } from "../values/TheHole";

// Array.prototype.{push, pop, map, filter, forEach, reduce} (ECMA-262 Array.prototype.*) for array
// receivers. Property access goes through HasProperty / Get so holes are skipped and the
// prototype chain is seen. Every element a builtin visits charges the work budget (Decision D3).

const MAX_ARRAY_LENGTH = 4294967295;
const ELEMENT = { writable: true, enumerable: true, configurable: true } as const;

/** How V8's builtins print a non-callable argument in kCalledNonCallable (typeof prefix, quoted strings). */
function describeNonCallable(v: JSValue): string {
  if (v === undefined) return "undefined";
  if (v === null) return "object null";
  if (typeof v === "string") return `string ${JSON.stringify(v)}`;
  if (typeof v === "number" || typeof v === "boolean") return `${typeof v} ${String(v)}`;
  return "object";
}

function thisArray(receiver: JSValue, method: string): JSArray {
  if (receiver instanceof JSArray) return receiver;
  throw new SimulationHalt({ kind: "unsupported", reason: `Array.prototype.${method} on a receiver that is not an array` });
}

function callbackOf(realm: Realm, value: JSValue): JSFunction | Completion<never> {
  if (value instanceof JSFunction) return value;
  return realm.throwTypeError(formatMessage("kCalledNonCallable", describeNonCallable(value)));
}

/** Visits the present elements below the length read at the start, calling `visit(value, index)`. */
function eachPresent(realm: Realm, array: JSArray, length: number, visit: (value: JSValue, index: number) => Completion<void>): Completion<void> {
  for (let k = 0; k < length; k++) {
    realm.work.charge();
    const key = String(k);
    if (!HasProperty(array, key)) continue;
    const done = visit(OrdinaryGet(array, key), k);
    if (isThrow(done)) return done;
  }
  return normal(undefined);
}

function createDataProperty(realm: Realm, array: JSArray, index: number, value: JSValue): void {
  OrdinaryDefineOwnProperty(realm, array, String(index), { value, ...ELEMENT });
}

export function installArray(realm: Realm): void {
  const proto = realm.intrinsics.arrayPrototype;
  // The arrays whose join is running (array-join.tq's JoinStack): a cycle joins as "".
  const joining = new Set<JSArray>();
  const method = (name: string, length: number, body: (realm: Realm, array: JSArray, args: readonly JSValue[]) => Completion): void => {
    realm.defineMethod(proto, name, length, (r, receiver, args) => body(r, thisArray(receiver, name), args));
  };

  method("push", 1, (r, array, args) => {
    const length = array.length;
    if (length + args.length > MAX_ARRAY_LENGTH) {
      throw new SimulationHalt({ kind: "unsupported", reason: "Array.prototype.push past the largest array length" });
    }
    args.forEach((item, i) => OrdinarySet(r, array, String(length + i), item));
    OrdinaryDefineOwnProperty(r, array, "length", { value: length + args.length });
    return normal(length + args.length);
  });

  method("pop", 0, (r, array) => {
    const length = array.length;
    if (length === 0) return normal(undefined);
    const key = String(length - 1);
    const element = OrdinaryGet(array, key);
    // The spec deletes the last element, then sets `length`. V8's fast path (src/builtins/array-pop.tq)
    // only shrinks the length, so the elements kind stays PACKED; with no accessors or non-configurable
    // elements in the subset, both leave the same JS-visible array.
    OrdinaryDefineOwnProperty(r, array, "length", { value: length - 1 });
    return normal(element);
  });

  // Array.prototype.toString calls `join`, which is not in the subset, so this is the default
  // join (separator ","): undefined and null elements (and holes) are "", the rest ToString.
  method("toString", 0, (r, array) => {
    if (joining.has(array)) return normal("");
    joining.add(array);
    try {
      const parts: string[] = [];
      for (let k = 0; k < array.length; k++) {
        r.work.charge();
        const element = OrdinaryGet(array, String(k));
        if (element === undefined || element === null) {
          parts.push("");
          continue;
        }
        const text = ToString(r, element);
        if (isThrow(text)) return text;
        parts.push(text.value);
      }
      return normal(parts.join(","));
    } finally {
      joining.delete(array);
    }
  });

  method("forEach", 1, (r, array, args) => {
    const callback = callbackOf(r, args[0]);
    if (!(callback instanceof JSFunction)) return callback;
    const done = eachPresent(r, array, array.length, (value, k) => {
      const result = r.call(callback, args[1], [value, k, array]);
      return isThrow(result) ? result : normal(undefined);
    });
    return isThrow(done) ? done : normal(undefined);
  });

  method("map", 1, (r, array, args) => {
    const callback = callbackOf(r, args[0]);
    if (!(callback instanceof JSFunction)) return callback;
    const length = array.length;
    if (array.map.elementsKind !== "DICTIONARY_ELEMENTS") {
      // FastArrayMap (src/builtins/array-map.tq): the results go into a Vector, and the array made
      // from it at the end is PACKED in the narrowest kind they need, HOLEY only if a hole was skipped.
      // The callback never sees the result array, so creating it last is not observable.
      const results: (JSValue | TheHoleValue)[] = [];
      const done = eachPresent(r, array, length, (value, k) => {
        const result = r.call(callback, args[1], [value, k, array]);
        if (isThrow(result)) return result;
        while (results.length < k) results.push(TheHole);
        results.push(result.value);
        return normal(undefined);
      });
      if (isThrow(done)) return done;
      while (results.length < length) results.push(TheHole);
      return normal(r.newArray(results));
    }
    // ArraySpeciesCreate for a plain array: a new Array of the same length, all holes.
    const mapped = r.newArray();
    mapped.setLength(r.maps, length);
    const done = eachPresent(r, array, length, (value, k) => {
      const result = r.call(callback, args[1], [value, k, array]);
      if (isThrow(result)) return result;
      createDataProperty(r, mapped, k, result.value);
      return normal(undefined);
    });
    return isThrow(done) ? done : normal(mapped);
  });

  method("filter", 1, (r, array, args) => {
    const callback = callbackOf(r, args[0]);
    if (!(callback instanceof JSFunction)) return callback;
    const kept = r.newArray();
    let to = 0;
    const done = eachPresent(r, array, array.length, (value, k) => {
      const result = r.call(callback, args[1], [value, k, array]);
      if (isThrow(result)) return result;
      if (ToBoolean(result.value)) createDataProperty(r, kept, to++, value);
      return normal(undefined);
    });
    return isThrow(done) ? done : normal(kept);
  });

  method("reduce", 1, (r, array, args) => {
    const callback = callbackOf(r, args[0]);
    if (!(callback instanceof JSFunction)) return callback;
    const length = array.length;
    let accumulator: JSValue = undefined;
    let k = 0;
    if (args.length >= 2) {
      accumulator = args[1];
    } else {
      let found = false;
      for (; k < length && !found; k++) {
        r.work.charge();
        const key = String(k);
        if (HasProperty(array, key)) {
          accumulator = OrdinaryGet(array, key);
          found = true;
        }
      }
      if (!found) return r.throwTypeError(formatMessage("kReduceNoInitial"));
    }
    for (; k < length; k++) {
      r.work.charge();
      const key = String(k);
      if (!HasProperty(array, key)) continue;
      const result = r.call(callback, undefined, [accumulator, OrdinaryGet(array, key), k, array]);
      if (isThrow(result)) return result;
      accumulator = result.value;
    }
    return normal(accumulator);
  });
}
