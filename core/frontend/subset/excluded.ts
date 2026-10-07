// The subset's one table of refusals (PROMPT.md §3.3 and §7.1). Every entry is a
// construct we refuse with a diagnostic instead of approximating. The same table
// renders the "Excluded" tables of docs/SUPPORTED_SUBSET.md and docs/FIDELITY.md,
// and a test fails when either document drifts from it.
//
// Relative imports with an extension, no `@/` alias: scripts/subset-docs.mts loads
// this file under plain Node type stripping.

import type { DiagnosticCode } from "../../shared/diagnostics.ts";

export type ExcludedEntry = {
  readonly id: string;
  /** What the user wrote, as shown in the docs tables. */
  readonly label: string;
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly hint: string;
  /** One sentence for the fidelity document: why we cannot be Exact here. */
  readonly reason: string;
};

const entry = (e: ExcludedEntry): ExcludedEntry => e;

const NOT_YET = "It can be added later, with fixtures recorded on real Node.";

export const EXCLUDED: readonly ExcludedEntry[] = [
  // ---- syntax deferred until it gets fixtures -------------------------------------
  entry({
    id: "class",
    label: "`class` declarations and expressions",
    code: "E_NOT_YET_SUPPORTED",
    message: "Classes are not supported yet.",
    hint: "Use a constructor function or an object literal with methods. Classes are a stretch goal that needs its own fixtures.",
    reason: `Classes (fields, private names, accessors) need their own recorded fixtures. ${NOT_YET}`,
  }),
  entry({
    id: "switch",
    label: "`switch`",
    code: "E_NOT_YET_SUPPORTED",
    message: "`switch` is not supported yet.",
    hint: "Rewrite it as an if / else if chain.",
    reason: NOT_YET,
  }),
  entry({
    id: "do-while",
    label: "`do…while`",
    code: "E_NOT_YET_SUPPORTED",
    message: "`do…while` is not supported yet.",
    hint: "Use `while` (run the body once before the loop if needed) or `for`.",
    reason: NOT_YET,
  }),
  entry({
    id: "for-in",
    label: "`for…in`",
    code: "E_NOT_YET_SUPPORTED",
    message: "`for…in` is not supported yet.",
    hint: "Loop over `Object.keys(obj)` with a `for` loop.",
    reason: `Enumeration order and prototype-chain walking need their own fixtures. ${NOT_YET}`,
  }),
  entry({
    id: "for-of",
    label: "`for…of` and `for await`",
    code: "E_NOT_YET_SUPPORTED",
    message: "`for…of` is not supported yet.",
    hint: "Use an indexed `for` loop over the array.",
    reason: `The iteration protocol (Symbol.iterator) is outside the subset. ${NOT_YET}`,
  }),
  entry({
    id: "labeled-statement",
    label: "labeled statements",
    code: "E_NOT_YET_SUPPORTED",
    message: "Labeled statements are not supported yet.",
    hint: "Restructure the loops, or use a flag variable or an early `return`.",
    reason: NOT_YET,
  }),
  entry({
    id: "destructuring",
    label: "destructuring patterns",
    code: "E_NOT_YET_SUPPORTED",
    message: "Destructuring is not supported yet.",
    hint: "Read each property or element with `obj.name` / `arr[0]` into its own variable.",
    reason: `Destructuring uses the iterator protocol for arrays. ${NOT_YET}`,
  }),
  entry({
    id: "spread-rest",
    label: "spread and rest (`...`)",
    code: "E_NOT_YET_SUPPORTED",
    message: "Spread and rest are not supported yet.",
    hint: "Pass arguments explicitly, and copy arrays or objects with a loop.",
    reason: `Spread uses the iterator protocol. ${NOT_YET}`,
  }),
  entry({
    id: "arguments-object",
    label: "`arguments`",
    code: "E_NOT_YET_SUPPORTED",
    message: "The `arguments` object is not supported yet.",
    hint: "Name the parameters you need.",
    reason: `Mapped/unmapped arguments objects differ by strictness and parameter lists. ${NOT_YET}`,
  }),
  entry({
    id: "instanceof",
    label: "`instanceof`",
    code: "E_NOT_YET_SUPPORTED",
    message: "`instanceof` is not supported yet.",
    hint: "Check a property you set yourself, or use `typeof`.",
    reason: `It depends on Symbol.hasInstance and prototype chains. ${NOT_YET}`,
  }),
  entry({
    id: "in-operator",
    label: "`in`",
    code: "E_NOT_YET_SUPPORTED",
    message: "The `in` operator is not supported yet.",
    hint: "Compare the property with `undefined`, or look it up in `Object.keys(obj)`.",
    reason: `It walks the prototype chain. ${NOT_YET}`,
  }),
  entry({
    id: "with-statement",
    label: "`with`",
    code: "E_NOT_YET_SUPPORTED",
    message: "`with` is not supported.",
    hint: "Refer to the object's properties explicitly.",
    reason: "`with` makes name resolution dynamic, which the scope model does not represent.",
  }),
  entry({
    id: "tagged-template",
    label: "tagged templates",
    code: "E_NOT_YET_SUPPORTED",
    message: "Tagged templates are not supported yet.",
    hint: "Call the function with the strings and values yourself, or use a plain template literal.",
    reason: `Template objects are cached per call site and frozen. ${NOT_YET}`,
  }),
  entry({
    id: "void-operator",
    label: "`void`",
    code: "E_NOT_YET_SUPPORTED",
    message: "The `void` operator is not supported yet.",
    hint: "Write `undefined` directly.",
    reason: NOT_YET,
  }),
  entry({
    id: "debugger",
    label: "`debugger`",
    code: "E_NOT_YET_SUPPORTED",
    message: "`debugger` statements are not supported.",
    hint: "Remove it: the playground has its own time-travel debugger.",
    reason: "It has no effect without an attached debugger.",
  }),
  entry({
    id: "computed-property-key",
    label: "computed keys in object literals",
    code: "E_NOT_YET_SUPPORTED",
    message: "Computed property names in object literals are not supported yet.",
    hint: "Create the object, then assign `obj[key] = value`.",
    reason: NOT_YET,
  }),
  entry({
    id: "new-target",
    label: "`new.target`",
    code: "E_NOT_YET_SUPPORTED",
    message: "`new.target` is not supported yet.",
    hint: "Pass the information in an argument.",
    reason: NOT_YET,
  }),

  // ---- syntax excluded for good reasons -----------------------------------------------
  entry({
    id: "generator",
    label: "generators and `yield`",
    code: "E_EXCLUDED_FEATURE",
    message: "Generator functions are not supported.",
    hint: "Use an async function with `await`, or a closure that keeps its own state.",
    reason: "Generators are excluded from the subset (async functions are supported).",
  }),
  entry({
    id: "getter-setter",
    label: "`get` / `set` accessors",
    code: "E_EXCLUDED_FEATURE",
    message: "Getters and setters are not supported.",
    hint: "Use plain methods such as `getValue()`.",
    reason: "Accessor properties change the hidden-class (Map) model and are excluded.",
  }),
  entry({
    id: "regex-literal",
    label: "regular expression literals",
    code: "E_EXCLUDED_FEATURE",
    message: "Regular expressions are not supported.",
    hint: "Use string methods such as `indexOf`, or a loop.",
    reason: "A faithful regex engine (Irregexp semantics) is out of scope.",
  }),
  entry({
    id: "bigint-literal",
    label: "`BigInt` literals (`1n`)",
    code: "E_EXCLUDED_FEATURE",
    message: "BigInt is not supported.",
    hint: "Use Number values.",
    reason: "BigInt is excluded from the subset.",
  }),
  entry({
    id: "dynamic-import",
    label: "`import()`, `import`/`export`, top-level `await`",
    code: "E_EXCLUDED_FEATURE",
    message: "Modules and dynamic import are not supported.",
    hint: "The script runs as one CommonJS file; put everything in it.",
    reason: "There is a single script; module loading is I/O.",
  }),
  entry({
    id: "prototype-access",
    label: "`.constructor`, `.prototype`, `__proto__`",
    code: "E_EXCLUDED_FEATURE",
    message: "Reaching into constructors and prototypes is not supported.",
    hint: "Use plain objects and functions. (`.constructor` is also the route to the `Function` constructor, which is refused.)",
    reason: "Prototype manipulation and `Function` access are outside the subset.",
  }),

  // ---- TypeScript that strip-only mode cannot erase ----------------------------------
  entry({
    id: "ts-enum",
    label: "TypeScript `enum`",
    code: "E_TS_UNSUPPORTED",
    message: "TypeScript enum is not supported in strip-only mode",
    hint: "Use a plain object (`as const`) or a union of string literals.",
    reason: "Node's strip-only type stripping refuses it too, because an enum has a runtime representation.",
  }),
  entry({
    id: "ts-namespace",
    label: "TypeScript `namespace` with values",
    code: "E_TS_UNSUPPORTED",
    message: "TypeScript namespace declaration is not supported in strip-only mode",
    hint: "Use an object literal or top-level functions.",
    reason: "Node's strip-only type stripping refuses it too.",
  }),
  entry({
    id: "ts-parameter-property",
    label: "TypeScript parameter properties",
    code: "E_TS_UNSUPPORTED",
    message: "TypeScript parameter property is not supported in strip-only mode",
    hint: "Declare the field and assign it in the constructor.",
    reason: "Node's strip-only type stripping refuses it too.",
  }),
  entry({
    id: "ts-other",
    label: "TypeScript `import x = require()`, `export =`, decorators, `<T>expr` casts",
    code: "E_TS_UNSUPPORTED",
    message: "This TypeScript syntax is not supported in strip-only mode",
    hint: "Use plain JavaScript for the runtime part.",
    reason: "Node's strip-only type stripping refuses these too.",
  }),

  // ---- globals and APIs ---------------------------------------------------------------
  entry({
    id: "Date",
    label: "`Date`",
    code: "E_EXCLUDED_API",
    message: "`Date` is not supported: it reads the clock and the time zone, so its output differs on every run.",
    hint: "Use `setTimeout` for ordering experiments; there is no wall clock in the playground.",
    reason: "Wall-clock and time-zone dependent.",
  }),
  entry({
    id: "Symbol",
    label: "`Symbol`",
    code: "E_EXCLUDED_API",
    message: "`Symbol` is not supported.",
    hint: "Use string keys.",
    reason: "Symbols are excluded from the subset.",
  }),
  entry({
    id: "BigInt",
    label: "`BigInt`",
    code: "E_EXCLUDED_API",
    message: "`BigInt` is not supported.",
    hint: "Use Number values.",
    reason: "BigInt is excluded from the subset.",
  }),
  entry({
    id: "Proxy",
    label: "`Proxy`, `Reflect`",
    code: "E_EXCLUDED_API",
    message: "`Proxy` and `Reflect` are not supported.",
    hint: "Use plain objects and functions.",
    reason: "Proxy traps change every object operation; they are excluded.",
  }),
  entry({
    id: "WeakRef",
    label: "`WeakRef`, `FinalizationRegistry`",
    code: "E_EXCLUDED_API",
    message: "`WeakRef` and `FinalizationRegistry` are not supported: their behaviour depends on garbage-collection timing.",
    hint: "Hold ordinary references.",
    reason: "GC-dependent, so never Exact.",
  }),
  entry({
    id: "performance",
    label: "`performance`",
    code: "E_EXCLUDED_API",
    message: "`performance` is not supported: it reads a clock, so its output differs on every run.",
    hint: "Order work with timers instead of measuring it.",
    reason: "Clock dependent.",
  }),
  entry({
    id: "fetch",
    label: "`fetch` and other I/O (`fs`, `http`, `URL`, streams, `crypto`, …)",
    code: "E_EXCLUDED_API",
    message: "`fetch` and other I/O are not supported.",
    hint: "The playground runs a single self-contained script with no network or file access.",
    reason: "I/O is never run.",
  }),
  entry({
    id: "eval",
    label: "`eval`, `Function`",
    code: "E_EXCLUDED_API",
    message: "`eval` and the `Function` constructor are not supported: they run code built from strings.",
    hint: "Write the code directly.",
    reason: "Dynamic code evaluation is never run, by design.",
  }),
  entry({
    id: "globalThis",
    label: "`globalThis`, `global`",
    code: "E_EXCLUDED_API",
    message: "`globalThis` is not supported: it would reach every global the subset excludes.",
    hint: "Refer to globals by name (`console`, `setTimeout`, …).",
    reason: "It would bypass the scope-resolved exclusion of other globals.",
  }),
  entry({
    id: "Math.*",
    label: "`Math` members other than `abs ceil floor max min round sign sqrt trunc`",
    code: "E_EXCLUDED_API",
    message: "This `Math` member is not supported: random is nondeterministic and the transcendental functions are approximated.",
    hint: "Supported: Math.abs, Math.ceil, Math.floor, Math.max, Math.min, Math.round, Math.sign, Math.sqrt, Math.trunc.",
    reason: "`Math.random` is nondeterministic; `sin`/`cos`/`exp`/`pow`/… are approximated and can differ between engines and versions.",
  }),
  entry({
    id: "process.*",
    label: "`process` members other than `nextTick`",
    code: "E_EXCLUDED_API",
    message: "This `process` member is not supported (it exposes the host).",
    hint: "Only `process.nextTick` is supported.",
    reason: "Environment, arguments, clocks and exit codes are host dependent.",
  }),
  entry({
    id: "require",
    label: "`require`, `__filename`, `__dirname`, `module` members",
    code: "E_EXCLUDED_API",
    message: "This module-system value is not supported: it is host dependent.",
    hint: "Only `typeof require`, `module.exports`, and `exports` can be used.",
    reason: "File paths and the module loader are host dependent.",
  }),
  entry({
    id: "alias",
    label: "a namespace global used as a value (`const m = Math`)",
    code: "E_EXCLUDED_API",
    message: "This global cannot be used as a value: aliasing it would hide which of its members run.",
    hint: "Call its members directly, for example `Math.floor(x)`.",
    reason: "Exclusions are resolved through scope analysis; an alias would bypass the member check.",
  }),
  entry({
    id: "member-not-supported",
    label: "other members of supported globals (`Object.assign`, `console.table`, `String.fromCharCode`, …)",
    code: "E_NOT_YET_SUPPORTED",
    message: "This member is not supported yet.",
    hint: "See docs/SUPPORTED_SUBSET.md for the supported members of each global.",
    reason: NOT_YET,
  }),
  entry({
    id: "node-global",
    label: "every other Node global (`JSON`, `Map`, `Set`, `parseInt`, `Buffer`, typed arrays, `Intl`, …)",
    code: "E_NOT_YET_SUPPORTED",
    message: "This global is not supported yet.",
    hint: "See docs/SUPPORTED_SUBSET.md for the supported globals.",
    reason: NOT_YET,
  }),

  // ---- limits -------------------------------------------------------------------------
  entry({
    id: "limit-source-size",
    label: "source larger than 10,240 bytes (UTF-8)",
    code: "E_LIMIT_SOURCE_SIZE",
    message: "The source is larger than 10,240 bytes.",
    hint: "Shorten the program.",
    reason: "A fixed limit keeps compilation and the simulation bounded.",
  }),
  entry({
    id: "limit-lines",
    label: "more than 400 lines",
    code: "E_LIMIT_LINES",
    message: "The source has more than 400 lines.",
    hint: "Shorten the program.",
    reason: "A fixed limit keeps compilation and the simulation bounded.",
  }),
];

const BY_ID: ReadonlyMap<string, ExcludedEntry> = new Map(EXCLUDED.map((e) => [e.id, e]));

export function excludedEntry(id: string): ExcludedEntry {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown excluded-table entry: ${id}`);
  return found;
}

// ---- name tables the validator resolves references against ---------------------------------

/** The names of the globals the subset allows to be referenced at all. */
export const ALLOWED_GLOBALS: ReadonlySet<string> = new Set([
  "console",
  "process",
  "Promise",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Math",
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "AggregateError",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
  "undefined",
  "NaN",
  "Infinity",
]);

/** Plain value/function globals: any use is fine. */
export const FREE_USE_GLOBALS: ReadonlySet<string> = new Set([
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
  "undefined",
  "NaN",
  "Infinity",
]);

/** Constructors/conversion functions: callable, constructible and passable, but with no static members yet. */
export const CONSTRUCTOR_GLOBALS: ReadonlySet<string> = new Set([
  "Array",
  "String",
  "Number",
  "Boolean",
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "AggregateError",
]);

/** Namespace-like globals: usable only through an allow-listed member (or `new Promise`, or `typeof`). */
export const NAMESPACE_MEMBERS: Readonly<Record<string, ReadonlySet<string>>> = {
  console: new Set(["log", "error", "warn"]),
  process: new Set(["nextTick"]),
  Math: new Set(["abs", "ceil", "floor", "max", "min", "round", "sign", "sqrt", "trunc"]),
  Object: new Set(["keys"]),
  Promise: new Set(["resolve", "reject", "all", "race", "allSettled", "any"]),
};

/** Member names that reach `Function`/prototypes and are refused on any receiver. */
export const PROTOTYPE_MEMBERS: ReadonlySet<string> = new Set(["constructor", "prototype", "__proto__"]);

/** Excluded globals that have their own entry (and message) in the table above. */
export const SPECIFIC_EXCLUDED_GLOBALS: Readonly<Record<string, string>> = {
  Date: "Date",
  Symbol: "Symbol",
  BigInt: "BigInt",
  Proxy: "Proxy",
  Reflect: "Proxy",
  WeakRef: "WeakRef",
  FinalizationRegistry: "WeakRef",
  performance: "performance",
  Performance: "performance",
  fetch: "fetch",
  "eval": "eval",
  "Function": "eval",
  globalThis: "globalThis",
  global: "globalThis",
};

/**
 * Every own property of `globalThis` in a Node 24.19.0 CommonJS main script
 * (`Object.getOwnPropertyNames(globalThis)`, sorted). A name outside this list is
 * not a global, so referencing it is a real ReferenceError we model exactly;
 * a name inside it that the subset does not allow is refused.
 * tests/conformance/subset-globals.test.ts re-derives it on the pinned Node.
 */
export const NODE_GLOBALS: readonly string[] = [
  "AbortController", "AbortSignal", "AggregateError", "Array", "ArrayBuffer", "AsyncDisposableStack", "Atomics",
  "BigInt", "BigInt64Array", "BigUint64Array", "Blob", "Boolean", "BroadcastChannel", "Buffer",
  "ByteLengthQueuingStrategy", "CloseEvent", "CompressionStream", "CountQueuingStrategy", "Crypto", "CryptoKey",
  "CustomEvent", "DOMException", "DataView", "Date", "DecompressionStream", "DisposableStack", "Error", "EvalError",
  "Event", "EventTarget", "File", "FinalizationRegistry", "Float16Array", "Float32Array", "Float64Array", "FormData",
  "Function", "Headers", "Infinity", "Int16Array", "Int32Array", "Int8Array", "Intl", "Iterator", "JSON", "Map",
  "Math", "MessageChannel", "MessageEvent", "MessagePort", "NaN", "Navigator", "Number", "Object", "Performance",
  "PerformanceEntry", "PerformanceMark", "PerformanceMeasure", "PerformanceObserver",
  "PerformanceObserverEntryList", "PerformanceResourceTiming", "Promise", "Proxy", "RangeError",
  "ReadableByteStreamController", "ReadableStream", "ReadableStreamBYOBReader", "ReadableStreamBYOBRequest",
  "ReadableStreamDefaultController", "ReadableStreamDefaultReader", "ReferenceError", "Reflect", "RegExp", "Request",
  "Response", "Set", "SharedArrayBuffer", "String", "SubtleCrypto", "SuppressedError", "Symbol", "SyntaxError",
  "TextDecoder", "TextDecoderStream", "TextEncoder", "TextEncoderStream", "TransformStream",
  "TransformStreamDefaultController", "TypeError", "URIError", "URL", "URLPattern", "URLSearchParams", "Uint16Array",
  "Uint32Array", "Uint8Array", "Uint8ClampedArray", "WeakMap", "WeakRef", "WeakSet", "WebAssembly", "WebSocket",
  "WritableStream", "WritableStreamDefaultController", "WritableStreamDefaultWriter", "atob", "btoa",
  "clearImmediate", "clearInterval", "clearTimeout", "console", "crypto", "decodeURI", "decodeURIComponent",
  "encodeURI", "encodeURIComponent", "escape", "eval", "fetch", "global", "globalThis", "isFinite", "isNaN",
  "navigator", "parseFloat", "parseInt", "performance", "process", "queueMicrotask", "setImmediate", "setInterval",
  "setTimeout", "structuredClone", "undefined", "unescape",
];

// ---- docs tables ---------------------------------------------------------------------------------

export const SUBSET_DOC_TABLE_BEGIN = "<!-- excluded-table:begin (generated by npm run docs:subset; do not edit) -->";
export const SUBSET_DOC_TABLE_END = "<!-- excluded-table:end -->";

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** The generated table for `SUPPORTED_SUBSET.md` ("subset") or `FIDELITY.md` ("fidelity"), markers included. */
export function renderExcludedTable(flavor: "subset" | "fidelity"): string {
  const lines: string[] = [SUBSET_DOC_TABLE_BEGIN, ""];
  if (flavor === "subset") {
    lines.push("| Construct | Diagnostic | Hint |", "|---|---|---|");
    for (const e of EXCLUDED) lines.push(`| ${cell(e.label)} | \`${e.code}\` | ${cell(e.hint)} |`);
  } else {
    lines.push("| Construct | Diagnostic | Why it is refused |", "|---|---|---|");
    for (const e of EXCLUDED) lines.push(`| ${cell(e.label)} | \`${e.code}\` | ${cell(e.reason)} |`);
  }
  lines.push("", SUBSET_DOC_TABLE_END);
  return lines.join("\n");
}
