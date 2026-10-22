import { type Completion, isThrow, normal } from "@/core/interpreter/Completion";
import { checkStringLength } from "../spec/operators";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { formatMessage } from "../messages";
import { JSArray } from "../objects/JSArray";
import { JSFunction } from "../objects/JSFunction";
import { JSObject } from "../objects/JSObject";
import type { Realm } from "../Realm";
import { HasProperty, OrdinaryDefineOwnProperty, OrdinaryDelete, OrdinaryGet, OrdinarySet } from "../spec/objectOps";
import { ToBoolean, ToNumber, ToString } from "../spec/conversions";
import type { JSValue } from "../values/JSValue";
import { TheHole, type TheHoleValue } from "../values/TheHole";

// Array.prototype.{push, pop, map, filter, forEach, reduce, concat, sort} (ECMA-262 Array.prototype.*) for array
// receivers. Property access goes through HasProperty / Get so holes are skipped and the
// prototype chain is seen. Every element a builtin visits charges the work budget (Decision D3).

const MAX_ARRAY_LENGTH = 4294967295;
/** TimSort sorts shorter arrays with one run and a binary insertion sort (array-sort.tq kMinMerge). */
const TIMSORT_MIN_MERGE = 64;
const ELEMENT = { writable: true, enumerable: true, configurable: true } as const;

/** How V8's builtins print a non-callable argument in kCalledNonCallable (typeof prefix, quoted strings). */
export function describeNonCallable(v: JSValue): string {
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

  // Array.prototype.join (array-join.tq): undefined and null elements (and holes) are "", the rest ToString.
  // A cycle joins as "". Array.prototype.toString is `join` with the default separator.
  const join = (r: Realm, array: JSArray, separator: string): Completion => {
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
      checkStringLength(parts.reduce((n, p) => n + p.length, separator.length * Math.max(parts.length - 1, 0)));
      return normal(parts.join(separator));
    } finally {
      joining.delete(array);
    }
  };

  method("join", 1, (r, array, args) => {
    const separator = args[0] === undefined ? { type: "normal" as const, value: "," } : ToString(r, args[0]);
    return isThrow(separator) ? separator : join(r, array, separator.value);
  });

  method("toString", 0, (r, array) => join(r, array, ","));

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

  // ArrayConcat: every element of an array argument, holes kept; any other argument is one element.
  method("concat", 1, (r, array, args) => {
    const values: (JSValue | TheHoleValue)[] = [];
    for (const item of [array, ...args]) {
      if (!(item instanceof JSArray)) {
        values.push(item);
        continue;
      }
      for (let k = 0; k < item.length; k++) {
        r.work.charge();
        const key = String(k);
        values.push(HasProperty(item, key) ? OrdinaryGet(item, key) : TheHole);
      }
    }
    return normal(r.newArray(values));
  });

  // Array.prototype.sort (src/builtins/array-sort.tq): holes dropped, undefineds last, the rest by TimSort.
  method("sort", 1, (r, array, args) => {
    const [comparefn] = args;
    if (comparefn !== undefined && !(comparefn instanceof JSFunction)) {
      return r.throwTypeError(formatMessage("kBadSortComparisonFunction", describeForSort(comparefn)));
    }
    const length = array.length;
    if (length < 2) return normal(array);
    const work: JSValue[] = [];
    let undefinedCount = 0;
    for (let k = 0; k < length; k++) {
      r.work.charge();
      const key = String(k);
      if (!HasProperty(array, key)) continue;
      const element = OrdinaryGet(array, key);
      if (element === undefined) undefinedCount++;
      else work.push(element);
    }
    const sorted = timSort(r, work, comparefn);
    if (isThrow(sorted)) return sorted;
    let index = 0;
    for (const element of work) OrdinarySet(r, array, String(index++), element);
    for (let i = 0; i < undefinedCount; i++) OrdinarySet(r, array, String(index++), undefined);
    for (; index < length; index++) OrdinaryDelete(r, array, String(index));
    return normal(array);
  });
}

/** The argument of kBadSortComparisonFunction as `NoSideEffectsToString` prints it (primitives only). */
function describeForSort(value: JSValue): string {
  if (value instanceof JSObject) throw new SimulationHalt({ kind: "unsupported", reason: "a TypeError message that prints an object comparison function" });
  return String(value);
}

/** SortState::Compare: the comparison function's number (NaN is 0), or the default order by ToString. */
function compareValues(realm: Realm, comparefn: JSFunction | undefined, x: JSValue, y: JSValue): Completion<number> {
  if (comparefn) {
    const called = realm.call(comparefn, undefined, [x, y]);
    if (isThrow(called)) return called;
    const order = ToNumber(realm, called.value);
    if (isThrow(order)) return order;
    return normal(Number.isNaN(order.value) ? 0 : order.value);
  }
  const xs = ToString(realm, x);
  if (isThrow(xs)) return xs;
  const ys = ToString(realm, y);
  if (isThrow(ys)) return ys;
  return normal(xs.value < ys.value ? -1 : ys.value < xs.value ? 1 : 0);
}

/**
 * ArrayTimSortImpl for fewer than 64 elements, where the minimum run length is the whole array:
 * CountAndMakeRun, then BinaryInsertionSort. The merge phase of longer arrays is not modeled.
 */
function timSort(realm: Realm, work: JSValue[], comparefn: JSFunction | undefined): Completion<void> {
  const length = work.length;
  if (length >= TIMSORT_MIN_MERGE) {
    throw new SimulationHalt({ kind: "unsupported", reason: "Array.prototype.sort of 64 or more elements (TimSort's merge phase is not modeled)" });
  }
  if (length < 2) return normal(undefined);
  // CountAndMakeRun(0, length)
  let runLength = 2;
  let order = compareValues(realm, comparefn, work[1], work[0]);
  if (isThrow(order)) return order;
  const descending = order.value < 0;
  let previous = work[1];
  for (let i = 2; i < length; i++) {
    const current = work[i];
    order = compareValues(realm, comparefn, current, previous);
    if (isThrow(order)) return order;
    if (descending ? order.value >= 0 : order.value < 0) break;
    previous = current;
    runLength++;
  }
  if (descending) work.splice(0, runLength, ...work.slice(0, runLength).reverse());
  // BinaryInsertionSort(0, runLength, length)
  for (let start = Math.max(runLength, 1); start < length; start++) {
    const pivot = work[start];
    let left = 0;
    let right = start;
    while (left < right) {
      const mid = left + ((right - left) >> 1);
      const result = compareValues(realm, comparefn, pivot, work[mid]);
      if (isThrow(result)) return result;
      if (result.value < 0) right = mid;
      else left = mid + 1;
    }
    for (let p = start; p > left; p--) work[p] = work[p - 1];
    work[left] = pivot;
  }
  return normal(undefined);
}
