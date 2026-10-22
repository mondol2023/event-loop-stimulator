// The string-keyed own properties of the builtins Node 24.19.0 (V8 13.6) really has, so that a
// member the model has not implemented stops the run as unsupported instead of reading as
// `undefined` (a fake "x is not a function"). Produced with Object.getOwnPropertyNames on the pinned
// runtime, minus constructor, length, name, prototype, caller and arguments; the table is checked
// against the pinned runtime by tests/conformance/node-members.test.ts. Members the realm does
// implement are removed from the lookup at startup (Realm), so this lists all of them.

export const NODE_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  "Object": [
    "assign", "create", "defineProperties", "defineProperty", "entries", "freeze", "fromEntries", "getOwnPropertyDescriptor",
    "getOwnPropertyDescriptors", "getOwnPropertyNames", "getOwnPropertySymbols", "getPrototypeOf", "groupBy", "hasOwn", "is",
    "isExtensible", "isFrozen", "isSealed", "keys", "preventExtensions", "seal", "setPrototypeOf", "values",
  ],
  "Object.prototype": [
    "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "__proto__", "hasOwnProperty", "isPrototypeOf",
    "propertyIsEnumerable", "toLocaleString", "toString", "valueOf",
  ],
  "Function.prototype": [
    "apply", "bind", "call", "toString",
  ],
  "Array": [
    "from", "fromAsync", "isArray", "of",
  ],
  "Array.prototype": [
    "at", "concat", "copyWithin", "entries", "every", "fill", "filter", "find", "findIndex", "findLast", "findLastIndex", "flat", "flatMap",
    "forEach", "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "pop", "push", "reduce", "reduceRight", "reverse", "shift",
    "slice", "some", "sort", "splice", "toLocaleString", "toReversed", "toSorted", "toSpliced", "toString", "unshift", "values", "with",
  ],
  "Promise": [
    "all", "allSettled", "any", "race", "reject", "resolve", "try", "withResolvers",
  ],
  "Promise.prototype": [
    "catch", "finally", "then",
  ],
  "String": [
    "fromCharCode", "fromCodePoint", "raw",
  ],
  "String.prototype": [
    "anchor", "at", "big", "blink", "bold", "charAt", "charCodeAt", "codePointAt", "concat", "endsWith", "fixed", "fontcolor", "fontsize",
    "includes", "indexOf", "isWellFormed", "italics", "lastIndexOf", "link", "localeCompare", "match", "matchAll", "normalize", "padEnd",
    "padStart", "repeat", "replace", "replaceAll", "search", "slice", "small", "split", "startsWith", "strike", "sub", "substr",
    "substring", "sup", "toLocaleLowerCase", "toLocaleUpperCase", "toLowerCase", "toString", "toUpperCase", "toWellFormed", "trim",
    "trimEnd", "trimLeft", "trimRight", "trimStart", "valueOf",
  ],
  "Number": [
    "EPSILON", "MAX_SAFE_INTEGER", "MAX_VALUE", "MIN_SAFE_INTEGER", "MIN_VALUE", "NEGATIVE_INFINITY", "NaN", "POSITIVE_INFINITY",
    "isFinite", "isInteger", "isNaN", "isSafeInteger", "parseFloat", "parseInt",
  ],
  "Number.prototype": [
    "toExponential", "toFixed", "toLocaleString", "toPrecision", "toString", "valueOf",
  ],
  "Boolean": [
   
  ],
  "Boolean.prototype": [
    "toString", "valueOf",
  ],
  "Error": [
    "captureStackTrace", "isError", "prepareStackTrace", "stackTraceLimit",
  ],
  "Error.prototype": [
    "message", "toString",
  ],
  "Math": [
    "E", "LN10", "LN2", "LOG10E", "LOG2E", "PI", "SQRT1_2", "SQRT2", "abs", "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh",
    "cbrt", "ceil", "clz32", "cos", "cosh", "exp", "expm1", "f16round", "floor", "fround", "hypot", "imul", "log", "log10", "log1p", "log2",
    "max", "min", "pow", "random", "round", "sign", "sin", "sinh", "sqrt", "tan", "tanh", "trunc",
  ],
};
