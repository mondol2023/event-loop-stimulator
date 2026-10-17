import { SimulationHalt } from "@/core/shared/simulationHalt";
import { HeapObject } from "../objects/HeapObject";
import { JSArray } from "../objects/JSArray";
import { JSObject } from "../objects/JSObject";
import { OrdinaryGet, OrdinaryGetOwnProperty, OrdinaryOwnPropertyKeys, toArrayIndex } from "../spec/objectOps";
import type { JSValue } from "../values/JSValue";
import { JSError, errorStack, errorToString } from "./errors";

// util.inspect as Node 24.19.0 runs it with the default options (lib/internal/util/inspect.js:
// depth 2, breakLength 80, compact 3, maxArrayLength 100, maxStringLength 10000, no colors,
// customInspect on but unreachable, showHidden off). Each function below is a port of the
// function of the same name there; the line numbers refer to that file. What the model cannot
// reproduce without running user code, or without ICU, stops the run (Decision D3).

/** What a function object is, as `FunctionPrototypeToString` and isAsyncFunction/isGeneratorFunction tell it. */
export type FunctionKind = "normal" | "async" | "generator" | "asyncGenerator" | "class";

/** `getPromiseDetails`: the [[PromiseState]] and [[PromiseResult]] slots. */
export type PromiseDetails =
  | { readonly state: "pending" }
  | { readonly state: "fulfilled" | "rejected"; readonly result: JSValue };

/** The realm facts inspect reads besides properties: the primordials and the internal slots. */
export interface InspectRealm {
  /** `wellKnownPrototypes` (inspect.js:617): the name if `o` is one of those intrinsic prototypes. */
  wellKnownPrototypeName(o: JSObject): string | undefined;
  /** `value[Symbol.toStringTag]` when it is a string that is not an own enumerable property, else `''`. */
  toStringTag(o: JSObject): string;
  functionKind(fn: JSObject): FunctionKind;
  /** The promise's state and result, or `undefined` when `o` is not a promise. */
  promiseDetails(o: JSObject): PromiseDetails | undefined;
}

export interface InspectOptions {
  readonly depth?: number;
}

// inspectDefaultOptions (inspect.js:184).
const BREAK_LENGTH = 80;
const COMPACT = 3;
const MAX_ARRAY_LENGTH = 100;
const MAX_STRING_LENGTH = 10000;

const kObjectType = 0;
const kArrayType = 1;
const kArrayExtrasType = 2;
type ExtrasType = typeof kObjectType | typeof kArrayType | typeof kArrayExtrasType;

const keyStrRegExp = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
const numberRegExp = /^(0|[1-9][0-9]*)$/;
const kMinLineLength = 16;

interface Ctx {
  readonly realm: InspectRealm;
  readonly budget: Map<number, number>;
  readonly seen: JSObject[];
  circular: Map<JSObject, number> | undefined;
  indentationLvl: number;
  currentDepth: number;
  depth: number;
}

function unsupported(reason: string): never {
  throw new SimulationHalt({ kind: "unsupported", reason });
}

/** `inspect(value, opts)` (inspect.js:330) with the default options and `depth` from `options`. */
export function inspect(realm: InspectRealm, value: JSValue, options: InspectOptions = {}): string {
  const ctx: Ctx = {
    realm,
    budget: new Map(),
    seen: [],
    circular: undefined,
    indentationLvl: 0,
    currentDepth: 0,
    depth: options.depth ?? 2,
  };
  return formatValue(ctx, value, 0);
}

// ---- strings and numbers ----

// Escaped control characters plus the single quote and the backslash (inspect.js:267 `meta`).
const meta: readonly string[] = Array.from({ length: 160 }, (_, code) => {
  const named: Record<number, string> = { 8: "\\b", 9: "\\t", 10: "\\n", 12: "\\f", 13: "\\r", 39: "\\'", 92: "\\\\" };
  const fixed = named[code];
  if (fixed !== undefined) return fixed;
  if (code < 32 || code > 126) return `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`;
  return "";
});

/** `addQuotes` (inspect.js:525): -1 is a double quote, -2 a backtick. */
function addQuotes(str: string, quotes: number): string {
  if (quotes === -1) return `"${str}"`;
  if (quotes === -2) return `\`${str}\``;
  return `'${str}'`;
}

/**
 * `strEscape` (inspect.js:540): picks the quote that needs no escaping, then escapes C0/C1
 * controls, the backslash, the chosen single quote and lone surrogates. The regex fast paths
 * there give the same result as this loop.
 */
function strEscape(str: string): string {
  let singleQuote = 39;
  if (str.includes("'")) {
    if (!str.includes('"')) singleQuote = -1;
    else if (!str.includes("`") && !str.includes("${")) singleQuote = -2;
  }
  let result = "";
  let last = 0;
  for (let i = 0; i < str.length; i++) {
    const point = str.charCodeAt(i);
    if (point === singleQuote || point === 92 || point < 32 || (point > 126 && point < 160)) {
      result += `${str.slice(last, i)}${meta[point] ?? ""}`;
      last = i + 1;
    } else if (point >= 0xd800 && point <= 0xdfff) {
      if (point <= 0xdbff && i + 1 < str.length) {
        const next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          i++;
          continue;
        }
      }
      result += `${str.slice(last, i)}\\u${point.toString(16)}`;
      last = i + 1;
    }
  }
  if (last !== str.length) result += str.slice(last);
  return addQuotes(result, singleQuote);
}

/** `formatNumber` (inspect.js:1925) without numeric separators: `-0` keeps its sign. */
export function formatNumber(n: number): string {
  return Object.is(n, -0) ? "-0" : `${n}`;
}

/** `formatPrimitive` (inspect.js:1967): long strings are split after each newline and joined with ` +`. */
function formatPrimitive(value: undefined | boolean | number | string, ctx: Ctx): string {
  if (typeof value === "string") {
    let trailer = "";
    if (value.length > MAX_STRING_LENGTH) {
      const remaining = value.length - MAX_STRING_LENGTH;
      value = value.slice(0, MAX_STRING_LENGTH);
      trailer = `... ${remaining} more character${remaining > 1 ? "s" : ""}`;
    }
    if (value.length > kMinLineLength && value.length > BREAK_LENGTH - ctx.indentationLvl - 4) {
      return (
        value
          .split(/(?<=\n)/)
          .map((line) => strEscape(line))
          .join(` +\n${" ".repeat(ctx.indentationLvl + 2)}`) + trailer
      );
    }
    return strEscape(value) + trailer;
  }
  if (typeof value === "number") return formatNumber(value);
  return `${value}`;
}

/** A property value that Node interpolates into a template literal: String() of a primitive. */
function templateString(v: JSValue, what: string): string {
  if (v instanceof HeapObject) unsupported(`util.inspect of ${what} that is an object (its toString would run)`);
  return String(v);
}

function truthy(v: JSValue): boolean {
  return v instanceof HeapObject || Boolean(v);
}

// ---- display width (only the grouping of long arrays measures it) ----

/** ICU's column width of one code point (node_i18n.cc GetColumnWidth), for the ranges the model knows. */
function icuCodePointWidth(code: number): number {
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return 0; // Cc
  if (code < 0x7f) return 1;
  if (code <= 0x2ff) return 1; // Latin-1 and the Latin Extended and IPA blocks (U+00AD is counted as 1 by Node)
  if (code <= 0x36f) return 0; // Combining Diacritical Marks: Mn
  if (code >= 0x1e00 && code <= 0x1eff) return 1; // Latin Extended Additional: NFC compositions of the above
  unsupported(`the ICU display width of U+${code.toString(16).toUpperCase().padStart(4, "0")} in a grouped array`);
}

/**
 * `getStringWidth(str, removeControlChars = ctx.colors)` (inspect.js:2672): ASCII counts one
 * column per printable character; from the first code unit >= 127 on, ICU measures the NFC form.
 */
function getStringWidth(str: string): number {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 127) {
      for (const ch of str.slice(i).normalize("NFC")) width += icuCodePointWidth(ch.codePointAt(0) ?? 0);
      break;
    }
    width += code >= 32 ? 1 : 0;
  }
  return width;
}

// ---- the dispatcher ----

/** `formatValue` (inspect.js:856). No proxies and no `[util.inspect.custom]` (symbols are not in the model). */
function formatValue(ctx: Ctx, value: JSValue, recurseTimes: number): string {
  if (!(value instanceof HeapObject)) return value === null ? "null" : formatPrimitive(value, ctx);
  if (!(value instanceof JSObject)) unsupported("util.inspect of a heap value that is not an object");
  if (ctx.seen.includes(value)) {
    let index = 1;
    if (ctx.circular === undefined) {
      ctx.circular = new Map([[value, index]]);
    } else {
      const known = ctx.circular.get(value);
      if (known === undefined) {
        index = ctx.circular.size + 1;
        ctx.circular.set(value, index);
      } else {
        index = known;
      }
    }
    return `[Circular *${index}]`;
  }
  return formatRaw(ctx, value, recurseTimes);
}

/** `Object.keys`: the enumerable own string keys in [[OwnPropertyKeys]] order. */
function enumerableKeys(o: JSObject): string[] {
  return OrdinaryOwnPropertyKeys(o).filter((k) => OrdinaryGetOwnProperty(o, k)?.enumerable === true);
}

/** `getOwnNonIndexProperties(value, ONLY_ENUMERABLE)`. */
function nonIndexEnumerableKeys(o: JSObject): string[] {
  return enumerableKeys(o).filter((k) => toArrayIndex(k) === undefined);
}

type Formatter = (ctx: Ctx, recurseTimes: number) => string[];

/** `formatRaw` (inspect.js:935), for the object kinds the model has. */
function formatRaw(ctx: Ctx, value: JSObject, recurseTimes: number): string {
  const constructor = getConstructorName(ctx, value);
  const tag = ctx.realm.toStringTag(value);
  let base = "";
  let formatter: Formatter = () => [];
  let braces: [string, string];
  let extrasType: ExtrasType = kObjectType;
  let keys: string[];

  // `SymbolIterator in value || constructor === null`, then ArrayIsArray. Ruling: every JSArray
  // takes this branch, even one whose prototype chain has lost @@iterator.
  if (value instanceof JSArray) {
    const prefix =
      constructor !== "Array" || tag !== "" ? getPrefix(constructor, tag, "Array", `(${value.length})`) : "";
    keys = nonIndexEnumerableKeys(value);
    braces = [`${prefix}[`, "]"];
    if (value.length === 0 && keys.length === 0) return `${braces[0]}]`;
    extrasType = kArrayExtrasType;
    formatter = (c, r) => formatArray(c, value, r);
  } else {
    keys = enumerableKeys(value);
    braces = ["{", "}"];
    const promise = ctx.realm.promiseDetails(value);
    if (value.isCallable) {
      base = getFunctionBase(ctx, value, constructor, tag);
      if (keys.length === 0) return base;
    } else if (constructor === "Object") {
      if (tag !== "") braces[0] = `${getPrefix(constructor, tag, "Object")}{`;
      if (keys.length === 0) return `${braces[0]}}`;
    } else if (isError(ctx, value)) {
      base = formatError(value, constructor, tag, ctx, keys);
      if (keys.length === 0) return base;
    } else if (promise !== undefined) {
      braces[0] = `${getPrefix(constructor, tag, "Promise")}{`;
      formatter = (c, r) => formatPromise(c, promise, r);
    } else {
      if (keys.length === 0) return `${getCtxStyle(ctx, value, constructor, tag)}{}`;
      braces[0] = `${getCtxStyle(ctx, value, constructor, tag)}{`;
    }
  }

  if (recurseTimes > ctx.depth) {
    let constructorName = getCtxStyle(ctx, value, constructor, tag).slice(0, -1);
    if (constructor !== null) constructorName = `[${constructorName}]`;
    return constructorName;
  }
  recurseTimes += 1;

  ctx.seen.push(value);
  ctx.currentDepth = recurseTimes;
  const output = formatter(ctx, recurseTimes);
  for (const key of keys) output.push(formatProperty(ctx, value, recurseTimes, key, extrasType));
  if (ctx.circular !== undefined) {
    const index = ctx.circular.get(value);
    if (index !== undefined) {
      const reference = `<ref *${index}>`;
      base = base === "" ? reference : `${reference} ${base}`;
    }
  }
  ctx.seen.pop();

  const res = reduceToSingleString(ctx, output, base, braces, extrasType, recurseTimes, value);
  const newLength = (ctx.budget.get(ctx.indentationLvl) ?? 0) + res.length;
  ctx.budget.set(ctx.indentationLvl, newLength);
  if (newLength > 2 ** 27) ctx.depth = -1;
  return res;
}

// ---- constructor names and prefixes ----

/** `isInstanceof` (inspect.js): `tmp instanceof ctor`, false where instanceof would throw (OrdinaryHasInstance). */
function isInstanceof(tmp: JSObject, ctor: JSObject): boolean {
  const proto = OrdinaryGet(ctor, "prototype");
  if (!(proto instanceof JSObject)) return false;
  for (let p = tmp.prototype; p !== null; p = p.prototype) if (p === proto) return true;
  return false;
}

/**
 * `getConstructorName` (inspect.js:657) without showHidden. A well-known prototype counts when
 * `tmp` is an instance of its primordial constructor, i.e. when it is strictly above `tmp`.
 */
function getConstructorName(ctx: Ctx, tmp: JSObject): string | null {
  let obj: JSObject | null = tmp;
  let firstProto: JSObject | null | undefined;
  while (obj !== null) {
    const wellKnown = ctx.realm.wellKnownPrototypeName(obj);
    if (wellKnown !== undefined && obj !== tmp) return wellKnown;
    const descriptor = OrdinaryGetOwnProperty(obj, "constructor");
    if (descriptor !== undefined && descriptor.value instanceof JSObject && descriptor.value.isCallable) {
      const name = OrdinaryGet(descriptor.value, "name");
      if (name !== "" && isInstanceof(tmp, descriptor.value)) return templateString(name, "a constructor name");
    }
    obj = obj.prototype;
    if (firstProto === undefined) firstProto = obj;
  }
  if (firstProto === null) return null;
  // `${internalGetConstructorName(tmp)} <${...}>`: a prototype chain with no named constructor.
  return unsupported("util.inspect of an object whose prototype chain has no constructor");
}

/**
 * `internalGetConstructorName` (V8 JSReceiver::GetConstructorName) for a null-prototype object.
 * Ruling: approximated by the object's kind; V8 reads the constructor its map was created with.
 */
function internalGetConstructorName(ctx: Ctx, value: JSObject): string {
  if (value instanceof JSArray) return "Array";
  if (value.isCallable) return "Function";
  if (value instanceof JSError) return "Error";
  if (ctx.realm.promiseDetails(value) !== undefined) return "Promise";
  return "Object";
}

/** `getCtxStyle` (inspect.js:827). */
function getCtxStyle(ctx: Ctx, value: JSObject, constructor: string | null, tag: string): string {
  let fallback = "";
  if (constructor === null) {
    fallback = internalGetConstructorName(ctx, value);
    if (fallback === tag) fallback = "Object";
  }
  return getPrefix(constructor, tag, fallback);
}

/** `getPrefix` (inspect.js:775). */
function getPrefix(constructor: string | null, tag: string, fallback: string, size = ""): string {
  if (constructor === null) {
    if (tag !== "" && fallback !== tag) return `[${fallback}${size}: null prototype] [${tag}] `;
    return `[${fallback}${size}: null prototype] `;
  }
  let result = `${constructor}${size} `;
  if (tag !== "") {
    const position = constructor.indexOf(tag);
    if (position === -1) {
      result += `[${tag}] `;
    } else {
      const endPos = position + tag.length;
      const after = constructor[endPos];
      if (endPos !== constructor.length && after !== undefined && after === after.toLowerCase()) result += `[${tag}] `;
    }
  }
  return result;
}

// ---- functions ----

/** `getFunctionBase` (inspect.js:1300). */
function getFunctionBase(ctx: Ctx, value: JSObject, constructor: string | null, tag: string): string {
  const kind = ctx.realm.functionKind(value);
  if (kind === "class") return getClassBase(value, constructor, tag);
  let type = "Function";
  if (kind === "generator" || kind === "asyncGenerator") type = `Generator${type}`;
  if (kind === "async" || kind === "asyncGenerator") type = `Async${type}`;
  let base = `[${type}`;
  if (constructor === null) base += " (null prototype)";
  const name = OrdinaryGet(value, "name");
  if (name === "") {
    base += " (anonymous)";
  } else if (typeof name === "string") {
    base += `: ${name}`;
  } else {
    if (name instanceof HeapObject) unsupported("util.inspect of a function whose name is an object");
    base += `: ${formatValue(ctx, name, 0)}`;
  }
  base += "]";
  if (constructor !== type && constructor !== null) base += ` ${constructor}`;
  if (tag !== "" && constructor !== tag) base += ` [${tag}]`;
  return base;
}

/** `getClassBase` (inspect.js:1278). */
function getClassBase(value: JSObject, constructor: string | null, tag: string): string {
  const hasName = OrdinaryGetOwnProperty(value, "name") !== undefined;
  const name = hasName ? OrdinaryGet(value, "name") : undefined;
  let base = `class ${hasName && truthy(name) ? templateString(name, "a class name") : "(anonymous)"}`;
  if (constructor !== "Function" && constructor !== null) base += ` [${constructor}]`;
  if (tag !== "" && constructor !== tag) base += ` [${tag}]`;
  if (constructor !== null) {
    const superName = value.prototype === null ? undefined : OrdinaryGet(value.prototype, "name");
    if (truthy(superName)) base += ` extends ${templateString(superName, "a superclass name")}`;
  } else {
    base += " extends [null prototype]";
  }
  return `[${base}]`;
}

// ---- errors ----

/** `isError` (lib/internal/util.js:99): isNativeError, or `instanceof Error`. */
function isError(ctx: Ctx, value: JSObject): boolean {
  if (value instanceof JSError) return true;
  for (let p = value.prototype; p !== null; p = p.prototype) if (ctx.realm.wellKnownPrototypeName(p) === "Error") return true;
  return false;
}

/** `err.stack`: V8's formatted stack unless the program stored its own. */
function readStack(err: JSObject): JSValue {
  if (err instanceof JSError && err.getOwnNamed("stack") === undefined) return errorStack(err);
  return OrdinaryGet(err, "stack");
}

/** `getStackString` (inspect.js:1470). */
function getStackString(err: JSObject): string {
  const stack = readStack(err);
  if (truthy(stack)) {
    if (typeof stack === "string") return stack;
    unsupported("util.inspect of an error whose stack is not a string");
  }
  return errorToString(err);
}

/** `identicalSequenceRange` (inspect.js:1338). */
function identicalSequenceRange(a: readonly string[], b: readonly string[]): [number, number] {
  for (let i = 0; i < a.length - 3; i++) {
    const pos = b.indexOf(a[i] ?? "");
    if (pos !== -1) {
      const rest = b.length - pos;
      if (rest > 3) {
        let len = 1;
        const maxLen = Math.min(a.length - i, rest);
        while (maxLen > len && a[i + len] === b[pos + len]) len++;
        if (len > 3) return [len, i];
      }
    }
  }
  return [0, 0];
}

/** `getStackFrames` (inspect.js:1492): drops the frames shared with `cause`. */
function getStackFrames(ctx: Ctx, err: JSObject, stack: string): string[] {
  const frames = stack.split("\n");
  const cause = OrdinaryGet(err, "cause");
  if (cause instanceof JSObject && isError(ctx, cause)) {
    const causeStack = getStackString(cause);
    const causeStackStart = causeStack.indexOf("\n    at");
    if (causeStackStart !== -1) {
      const causeFrames = causeStack.slice(causeStackStart + 1).split("\n");
      const [len, offset] = identicalSequenceRange(frames, causeFrames);
      if (len > 0) {
        const skipped = len - 2;
        frames.splice(offset + 1, skipped, `    ... ${skipped} lines matching cause stack trace ...`);
      }
    }
  }
  // getDuplicateErrorFrameRanges: a captured stack has at most Error.stackTraceLimit (10) frames.
  if (frames.length > 10) unsupported("util.inspect of an error stack with more than 10 frames");
  return frames;
}

/** `improveStack` (inspect.js:1539). */
function improveStack(stack: string, constructor: string | null, name: string, tag: string): string {
  let len = name.length;
  if (
    constructor === null ||
    (name.endsWith("Error") &&
      stack.startsWith(name) &&
      (stack.length === len || stack[len] === ":" || stack[len] === "\n"))
  ) {
    let fallback = "Error";
    if (constructor === null) {
      const start =
        /^([A-Z][a-z_ A-Z0-9[\]()-]+)(?::|\n {4}at)/.exec(stack) ?? /^([a-z_A-Z0-9-]*Error)$/.exec(stack);
      fallback = start?.[1] ?? "";
      len = fallback.length;
      fallback ||= "Error";
    }
    const prefix = getPrefix(constructor, tag, fallback).slice(0, -1);
    if (name !== prefix) {
      if (prefix.includes(name)) {
        stack = len === 0 ? `${prefix}: ${stack}` : `${prefix}${stack.slice(len)}`;
      } else {
        stack = `${prefix} [${name}]${stack.slice(len)}`;
      }
    }
  }
  return stack;
}

/** `formatError` (inspect.js:1667). Removes the keys the stack already shows; adds `cause` and `errors`. */
function formatError(err: JSObject, constructor: string | null, tag: string, ctx: Ctx, keys: string[]): string {
  let stack = getStackString(err);
  const message = OrdinaryGet(err, "message");
  const rawName = OrdinaryGet(err, "name");
  const remove = (key: string, when: boolean): void => {
    const index = keys.indexOf(key);
    if (index !== -1 && when) keys.splice(index, 1);
  };
  if (keys.length !== 0) {
    remove("stack", true);
    remove("message", typeof message !== "string" || stack.includes(message));
    remove("name", typeof rawName !== "string" || stack.includes(rawName));
  }
  const name = rawName ?? "Error";
  if (OrdinaryGetOwnProperty(err, "cause") !== undefined && !keys.includes("cause")) keys.push("cause");
  if (
    OrdinaryGet(err, "errors") instanceof JSArray &&
    OrdinaryGetOwnProperty(err, "errors") !== undefined &&
    !keys.includes("errors")
  ) {
    keys.push("errors");
  }

  if (typeof name !== "string") unsupported("util.inspect of an error whose name is not a string");
  stack = improveStack(stack, constructor, name, tag);

  // Ignore the error message if it's contained in the stack: `(message && indexOf) || -1`, and
  // `pos + message.length` is NaN (so 0) for a message that is not a string.
  let pos = -1;
  if (truthy(message)) {
    const at = stack.indexOf(templateString(message, "an error message"));
    pos = at === 0 ? -1 : at;
  }
  if (pos !== -1) pos = typeof message === "string" ? pos + message.length : 0;
  const stackStart = stack.indexOf("\n    at", pos);
  if (stackStart === -1) {
    stack = `[${stack}]`;
  } else {
    const lines = getStackFrames(ctx, err, stack.slice(stackStart + 1));
    stack = `${stack.slice(0, stackStart)}\n${lines.join("\n")}`;
  }
  if (ctx.indentationLvl !== 0) stack = stack.replaceAll("\n", `\n${" ".repeat(ctx.indentationLvl)}`);
  return stack;
}

// ---- promises, arrays and properties ----

/** `formatPromise` (inspect.js:2254). */
function formatPromise(ctx: Ctx, details: PromiseDetails, recurseTimes: number): string[] {
  if (details.state === "pending") return ["<pending>"];
  ctx.indentationLvl += 2;
  const str = formatValue(ctx, details.result, recurseTimes);
  ctx.indentationLvl -= 2;
  return [details.state === "rejected" ? `<rejected> ${str}` : str];
}

const remainingText = (remaining: number): string => `... ${remaining} more item${remaining > 1 ? "s" : ""}`;

/** `formatSpecialArray` (inspect.js:2029): the array is sparse; holes print as `<n empty items>`. */
function formatSpecialArray(
  ctx: Ctx,
  value: JSArray,
  recurseTimes: number,
  maxLength: number,
  output: string[],
  i: number,
): string[] {
  const keys = enumerableKeys(value);
  let index = i;
  for (; i < keys.length && output.length < maxLength; i++) {
    const key = keys[i] ?? "";
    const tmp = Number(key);
    if (tmp > 2 ** 32 - 2) break;
    if (`${index}` !== key) {
      if (numberRegExp.exec(key) === null) break;
      const emptyItems = tmp - index;
      output.push(`<${emptyItems} empty item${emptyItems > 1 ? "s" : ""}>`);
      index = tmp;
      if (output.length === maxLength) break;
    }
    output.push(formatProperty(ctx, value, recurseTimes, key, kArrayType));
    index++;
  }
  const remaining = value.length - index;
  if (output.length !== maxLength) {
    if (remaining > 0) output.push(`<${remaining} empty item${remaining > 1 ? "s" : ""}>`);
  } else if (remaining > 0) {
    output.push(remainingText(remaining));
  }
  return output;
}

/** `formatArray` (inspect.js:2087). */
function formatArray(ctx: Ctx, value: JSArray, recurseTimes: number): string[] {
  const valLen = value.length;
  const len = Math.min(Math.max(0, MAX_ARRAY_LENGTH), valLen);
  const remaining = valLen - len;
  const output: string[] = [];
  for (let i = 0; i < len; i++) {
    if (OrdinaryGetOwnProperty(value, String(i)) === undefined) {
      return formatSpecialArray(ctx, value, recurseTimes, len, output, i);
    }
    output.push(formatProperty(ctx, value, recurseTimes, String(i), kArrayType));
  }
  if (remaining > 0) output.push(remainingText(remaining));
  return output;
}

/** `formatProperty` (inspect.js:2282) for data properties (accessors are not in the model). */
function formatProperty(ctx: Ctx, value: JSObject, recurseTimes: number, key: string, type: ExtrasType): string {
  const desc = OrdinaryGetOwnProperty(value, key);
  let str: string;
  if (desc !== undefined && desc.value !== undefined) {
    ctx.indentationLvl += 2;
    str = formatValue(ctx, desc.value, recurseTimes);
    ctx.indentationLvl -= 2;
  } else {
    str = "undefined";
  }
  if (type === kArrayType) return str;
  let name: string;
  if (keyStrRegExp.exec(key) !== null) name = key === "__proto__" ? "['__proto__']" : key;
  else name = strEscape(key);
  if (desc?.enumerable === false) name = `[${name}]`;
  return `${name}: ${str}`;
}

/** `groupArrayElements` (inspect.js:1779): lays out more than six short entries in columns. */
function groupArrayElements(ctx: Ctx, output: string[], value: JSObject | undefined): string[] {
  let totalLength = 0;
  let maxLength = 0;
  let outputLength = output.length;
  if (MAX_ARRAY_LENGTH < output.length) outputLength--;
  const separatorSpace = 2;
  const dataLen: number[] = [];
  for (let i = 0; i < outputLength; i++) {
    const len = getStringWidth(output[i] ?? "");
    dataLen[i] = len;
    totalLength += len + separatorSpace;
    if (maxLength < len) maxLength = len;
  }
  const actualMax = maxLength + separatorSpace;
  if (actualMax * 3 + ctx.indentationLvl < BREAK_LENGTH && (totalLength / actualMax > 5 || maxLength <= 6)) {
    const approxCharHeights = 2.5;
    const averageBias = Math.sqrt(actualMax - totalLength / output.length);
    const biasedMax = Math.max(actualMax - 3 - averageBias, 1);
    const columns = Math.min(
      Math.round(Math.sqrt(approxCharHeights * biasedMax * outputLength) / biasedMax),
      Math.floor((BREAK_LENGTH - ctx.indentationLvl) / actualMax),
      COMPACT * 4,
      15,
    );
    if (columns <= 1) return output;
    const tmp: string[] = [];
    const maxLineLength: number[] = [];
    for (let i = 0; i < columns; i++) {
      let lineMaxLength = 0;
      for (let j = i; j < output.length; j += columns) {
        const len = dataLen[j];
        if (len !== undefined && len > lineMaxLength) lineMaxLength = len;
      }
      maxLineLength[i] = lineMaxLength + separatorSpace;
    }
    let padStart = true;
    if (value !== undefined) {
      for (let i = 0; i < output.length; i++) {
        if (typeof OrdinaryGet(value, String(i)) !== "number") {
          padStart = false;
          break;
        }
      }
    }
    for (let i = 0; i < outputLength; i += columns) {
      const max = Math.min(i + columns, outputLength);
      let str = "";
      let j = i;
      for (; j < max - 1; j++) {
        const entry = output[j] ?? "";
        const padding = (maxLineLength[j - i] ?? 0) + entry.length - (dataLen[j] ?? 0);
        str += padStart ? `${entry}, `.padStart(padding, " ") : `${entry}, `.padEnd(padding, " ");
      }
      const entry = output[j] ?? "";
      if (padStart) {
        const padding = (maxLineLength[j - i] ?? 0) + entry.length - (dataLen[j] ?? 0) - separatorSpace;
        str += entry.padStart(padding, " ");
      } else {
        str += entry;
      }
      tmp.push(str);
    }
    if (MAX_ARRAY_LENGTH < output.length) tmp.push(output[outputLength] ?? "");
    return tmp;
  }
  return output;
}

/** `isBelowBreakLength` (inspect.js:2348). */
function isBelowBreakLength(output: readonly string[], start: number, base: string): boolean {
  let totalLength = output.length + start;
  if (totalLength + output.length > BREAK_LENGTH) return false;
  for (const entry of output) {
    totalLength += entry.length;
    if (totalLength > BREAK_LENGTH) return false;
  }
  return base === "" || !base.includes("\n");
}

/** `reduceToSingleString` (inspect.js:2372) for `compact: 3`. */
function reduceToSingleString(
  ctx: Ctx,
  output: string[],
  base: string,
  braces: readonly [string, string],
  extrasType: ExtrasType,
  recurseTimes: number,
  value: JSObject,
): string {
  const entries = output.length;
  if (extrasType === kArrayExtrasType && entries > 6) output = groupArrayElements(ctx, output, value);
  if (ctx.currentDepth - recurseTimes < COMPACT && entries === output.length) {
    const start = output.length + ctx.indentationLvl + braces[0].length + base.length + 10;
    if (isBelowBreakLength(output, start, base)) {
      const joinedOutput = output.join(", ");
      if (!joinedOutput.includes("\n")) return `${base ? `${base} ` : ""}${braces[0]} ${joinedOutput} ${braces[1]}`;
    }
  }
  const indentation = `\n${" ".repeat(ctx.indentationLvl)}`;
  return `${base ? `${base} ` : ""}${braces[0]}${indentation}  ${output.join(`,${indentation}  `)}${indentation}${braces[1]}`;
}
