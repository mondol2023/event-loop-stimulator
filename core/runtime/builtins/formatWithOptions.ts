import { SimulationHalt } from "@/core/shared/simulationHalt";
import { HeapObject } from "../objects/HeapObject";
import { JSObject } from "../objects/JSObject";
import { OrdinaryGet, OrdinaryGetOwnProperty } from "../spec/objectOps";
import type { JSValue } from "../values/JSValue";
import { type InspectRealm, formatNumber, inspect } from "./inspect";

// util.formatWithOptions({}, ...args), the formatting behind console.log
// (lib/internal/util/inspect.js:2533 formatWithOptionsInternal, Node 24.19.0). A directive that
// would run user code (a user toString or valueOf) or that is not modeled (%j, %o, %O) stops the
// run instead (Decision D3).

/**
 * `builtInObjects` (inspect.js:226): the global names matching /^[A-Z][a-zA-Z0-9]+$/. Ruling: the
 * ECMAScript and V8 globals, not Node's runtime-only ones (Buffer, URL, ...).
 */
const builtInObjects = new Set([
  "Object", "Function", "Array", "Number", "Boolean", "String", "Symbol", "Date", "Promise", "RegExp",
  "Error", "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError",
  "URIError", "SuppressedError", "JSON", "Math", "Intl", "ArrayBuffer", "Atomics", "Uint8Array",
  "Int8Array", "Uint16Array", "Int16Array", "Uint32Array", "Int32Array", "Float16Array", "Float32Array",
  "Float64Array", "Uint8ClampedArray", "BigUint64Array", "BigInt64Array", "DataView", "Map", "BigInt",
  "Set", "WeakMap", "WeakSet", "Proxy", "Reflect", "FinalizationRegistry", "WeakRef",
  "SharedArrayBuffer", "WebAssembly", "Iterator", "DisposableStack", "AsyncDisposableStack",
]);

function unsupported(reason: string): never {
  throw new SimulationHalt({ kind: "unsupported", reason });
}

const isCallable = (v: JSValue): boolean => v instanceof HeapObject && v.isCallable;

/** `hasBuiltInToString` (inspect.js:2435), with no Symbol.toPrimitive (symbols are not in the model). */
function hasBuiltInToString(value: JSObject): boolean {
  if (!isCallable(OrdinaryGet(value, "toString"))) return true;
  if (OrdinaryGetOwnProperty(value, "toString") !== undefined) return false;
  let pointer: JSObject | null = value;
  do {
    pointer = pointer.prototype;
  } while (pointer !== null && OrdinaryGetOwnProperty(pointer, "toString") === undefined);
  if (pointer === null) return true;
  const descriptor = OrdinaryGetOwnProperty(pointer, "constructor");
  if (descriptor === undefined || !(descriptor.value instanceof JSObject) || !descriptor.value.isCallable) return false;
  const name = OrdinaryGet(descriptor.value, "name");
  return typeof name === "string" && builtInObjects.has(name);
}

/** A primitive argument of %d, %i or %f; an object would run its valueOf or toString. */
function numericArgument(v: JSValue, directive: string): Exclude<JSValue, HeapObject> {
  if (v instanceof HeapObject) unsupported(`console formatting of ${directive} with an object argument (its valueOf would run)`);
  return v;
}

/** `%s` (inspect.js:2552). */
function formatS(realm: InspectRealm, arg: JSValue): string {
  if (typeof arg === "number") return formatNumber(arg);
  if (!(arg instanceof HeapObject)) return String(arg);
  if (arg.isCallable) unsupported("console formatting of %s with a function (Function.prototype.toString)");
  if (!(arg instanceof JSObject) || !hasBuiltInToString(arg)) {
    unsupported("console formatting of %s with an object that has its own toString");
  }
  return inspect(realm, arg, { depth: 0 });
}

/** `formatWithOptionsInternal({}, args)` (inspect.js:2533). */
export function formatWithOptions(realm: InspectRealm, args: readonly JSValue[]): string {
  const first = args[0];
  let a = 0;
  let str = "";
  let join = "";
  const arg = (): JSValue => args[++a];

  if (typeof first === "string") {
    if (args.length === 1) return first;
    let tempStr = "";
    let lastPos = 0;
    for (let i = 0; i < first.length - 1; i++) {
      if (first.charCodeAt(i) !== 37) continue; // '%'
      const nextChar = first.charCodeAt(++i);
      if (a + 1 !== args.length) {
        switch (nextChar) {
          case 115: // 's'
            tempStr = formatS(realm, arg());
            break;
          case 106: // 'j'
          case 79: // 'O'
          case 111: // 'o'
            unsupported(`console formatting of %${String.fromCharCode(nextChar)}`);
          case 100: // 'd'
            tempStr = formatNumber(Number(numericArgument(arg(), "%d")));
            break;
          case 105: // 'i'
            tempStr = formatNumber(Number.parseInt(String(numericArgument(arg(), "%i"))));
            break;
          case 102: // 'f'
            tempStr = formatNumber(Number.parseFloat(String(numericArgument(arg(), "%f"))));
            break;
          case 99: // 'c'
            a += 1;
            tempStr = "";
            break;
          case 37: // '%'
            str += first.slice(lastPos, i);
            lastPos = i + 1;
            continue;
          default: // not a placeholder
            continue;
        }
        if (lastPos !== i - 1) str += first.slice(lastPos, i - 1);
        str += tempStr;
        lastPos = i + 1;
      } else if (nextChar === 37) {
        str += first.slice(lastPos, i);
        lastPos = i + 1;
      }
    }
    if (lastPos !== 0) {
      a++;
      join = " ";
      if (lastPos < first.length) str += first.slice(lastPos);
    }
  }

  while (a < args.length) {
    const value = args[a];
    str += join;
    str += typeof value !== "string" ? inspect(realm, value) : value;
    join = " ";
    a++;
  }
  return str;
}
