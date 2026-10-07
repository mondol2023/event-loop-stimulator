import { describe, expect, it } from "vitest";
import type { Diagnostic, DiagnosticCode } from "@/core/shared/diagnostics";
import { parseScript } from "../parse";
import { analyzeScopes } from "../scope/ScopeAnalyzer";
import { checkSourceLimits, validateSubset } from "./validator";

// Every source string below (including ones that call `eval` or `Function`) is only
// parsed and analysed; the validator exists to refuse them, and nothing here runs them.
function diagnose(source: string): Diagnostic[] {
  const parsed = parseScript(source);
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`);
  return validateSubset(parsed.value, analyzeScopes(parsed.value));
}

const text = (source: string, d: Diagnostic | undefined) => source.slice(d?.range.start, d?.range.end);

type Case = { name: string; source: string; code: DiagnosticCode; token: string };

function expectSingle(c: Case): void {
  const d = diagnose(c.source);
  expect(d, `${c.name}: ${JSON.stringify(d)}`).toHaveLength(1);
  const only = d[0] as Diagnostic;
  expect(only.code).toBe(c.code);
  expect(text(c.source, only)).toBe(c.token);
  expect(only.hint.length).toBeGreaterThan(5);
  expect(only.message.length).toBeGreaterThan(5);
  expect(only.docs).toContain("SUPPORTED_SUBSET.md");
}

describe("excluded syntax: one diagnostic over the offending token, with a hint", () => {
  const cases: Case[] = [
    { name: "class", source: "class A {}", code: "E_NOT_YET_SUPPORTED", token: "class" },
    { name: "class expression", source: "const A = class {};", code: "E_NOT_YET_SUPPORTED", token: "class" },
    { name: "switch", source: "switch (1) {}", code: "E_NOT_YET_SUPPORTED", token: "switch" },
    { name: "do-while", source: "do {} while (0);", code: "E_NOT_YET_SUPPORTED", token: "do" },
    { name: "for-in", source: "for (var k in {}) {}", code: "E_NOT_YET_SUPPORTED", token: "for" },
    { name: "for-of", source: "for (var v of []) {}", code: "E_NOT_YET_SUPPORTED", token: "for" },
    { name: "labeled statement", source: "a: for (;;) { break a; }", code: "E_NOT_YET_SUPPORTED", token: "a" },
    { name: "object destructuring", source: "const {a} = {a: 1};", code: "E_NOT_YET_SUPPORTED", token: "{a}" },
    { name: "array destructuring", source: "const [x] = [1];", code: "E_NOT_YET_SUPPORTED", token: "[x]" },
    { name: "destructuring assignment", source: "let a; [a] = [1];", code: "E_NOT_YET_SUPPORTED", token: "[a]" },
    { name: "spread", source: "f(...[1]);", code: "E_NOT_YET_SUPPORTED", token: "...[1]" },
    { name: "rest parameter", source: "function f(...r) {}", code: "E_NOT_YET_SUPPORTED", token: "...r" },
    { name: "arguments", source: "function f() { return arguments; }", code: "E_NOT_YET_SUPPORTED", token: "arguments" },
    { name: "instanceof", source: "a instanceof b;", code: "E_NOT_YET_SUPPORTED", token: "instanceof" },
    { name: "in", source: "'a' in b;", code: "E_NOT_YET_SUPPORTED", token: "in" },
    { name: "with", source: "with (a) {}", code: "E_NOT_YET_SUPPORTED", token: "with" },
    { name: "tagged template", source: "tag`x`;", code: "E_NOT_YET_SUPPORTED", token: "tag`x`" },
    { name: "void", source: "void 0;", code: "E_NOT_YET_SUPPORTED", token: "void" },
    { name: "debugger", source: "debugger;", code: "E_NOT_YET_SUPPORTED", token: "debugger" },
    { name: "computed key", source: "({ [k]: 1 });", code: "E_NOT_YET_SUPPORTED", token: "k" },
    { name: "new.target", source: "function f() { new.target; }", code: "E_NOT_YET_SUPPORTED", token: "new.target" },
    { name: "generator", source: "function* g() {}", code: "E_EXCLUDED_FEATURE", token: "*" },
    { name: "async generator", source: "async function* g() {}", code: "E_EXCLUDED_FEATURE", token: "*" },
    { name: "getter", source: "({ get x() { return 1; } });", code: "E_EXCLUDED_FEATURE", token: "x" },
    { name: "setter", source: "({ set x(v) {} });", code: "E_EXCLUDED_FEATURE", token: "x" },
    { name: "regex literal", source: "/ab+c/g;", code: "E_EXCLUDED_FEATURE", token: "/ab+c/g" },
    { name: "bigint literal", source: "1n;", code: "E_EXCLUDED_FEATURE", token: "1n" },
    { name: "dynamic import", source: 'import("x");', code: "E_EXCLUDED_FEATURE", token: 'import("x")' },
    { name: ".constructor", source: "x.constructor;", code: "E_EXCLUDED_FEATURE", token: "constructor" },
    { name: ".prototype", source: "x.prototype;", code: "E_EXCLUDED_FEATURE", token: "prototype" },
    { name: "__proto__ member", source: "x.__proto__;", code: "E_EXCLUDED_FEATURE", token: "__proto__" },
    { name: "['constructor']", source: "x['constructor'];", code: "E_EXCLUDED_FEATURE", token: "'constructor'" },
    { name: "__proto__ literal key", source: "({ __proto__: null });", code: "E_EXCLUDED_FEATURE", token: "__proto__" },
  ];
  for (const c of cases) it(c.name, () => expectSingle(c));

  it("a class reports once, not once per member", () => {
    expect(diagnose("class A { a() {} b() { switch (1) {} } }")).toHaveLength(1);
  });

  it("supported syntax produces no diagnostics", () => {
    const source = [
      "'use strict';",
      "let a = 1, b = 'x', c = null, d = undefined;",
      "const t = `v=${a}`;",
      "if (a == 1 && b === 'x' || (c ?? d)) { a++; } else { a--; }",
      "for (let i = 0; i < 3; i++) { if (i) continue; else break; }",
      "while (a > 0) { a -= 1; a <<= 1; a |= 2; }",
      "function f(x, y = 2) { return x + y; }",
      "const g = (x) => x * 2;",
      "const h = async () => { await 1; };",
      "const o = { p: 1, q() { return this.p; }, a };",
      "delete o.p; o.z = typeof o?.z ?? 1;",
      "try { throw new Error('x'); } catch (e) { e.message; } finally { a = ~a; }",
      "const arr = [1, , 3]; arr.push(4); arr.map(g);",
      "let seq = (1, 2); seq = 2 ** 10; seq **= 2;",
      "return a ? 1 : 2;",
    ].join("\n");
    expect(diagnose(source)).toEqual([]);
  });
});

describe("excluded globals, resolved through scope analysis", () => {
  const cases: Case[] = [
    { name: "Date.now", source: "Date.now();", code: "E_EXCLUDED_API", token: "Date" },
    { name: "new Date", source: "new Date();", code: "E_EXCLUDED_API", token: "Date" },
    { name: "Symbol", source: "Symbol('x');", code: "E_EXCLUDED_API", token: "Symbol" },
    { name: "BigInt", source: "BigInt(1);", code: "E_EXCLUDED_API", token: "BigInt" },
    { name: "Proxy", source: "new Proxy({}, {});", code: "E_EXCLUDED_API", token: "Proxy" },
    { name: "Reflect", source: "Reflect.get({}, 'a');", code: "E_EXCLUDED_API", token: "Reflect" },
    { name: "WeakRef", source: "new WeakRef({});", code: "E_EXCLUDED_API", token: "WeakRef" },
    { name: "FinalizationRegistry", source: "new FinalizationRegistry(f);", code: "E_EXCLUDED_API", token: "FinalizationRegistry" },
    { name: "performance", source: "performance.now();", code: "E_EXCLUDED_API", token: "performance" },
    { name: "fetch", source: "fetch('x');", code: "E_EXCLUDED_API", token: "fetch" },
    { name: "eval", source: "eval('1');", code: "E_EXCLUDED_API", token: "eval" },
    { name: "Function", source: "Function('return 1');", code: "E_EXCLUDED_API", token: "Function" },
    { name: "globalThis", source: "globalThis.x;", code: "E_EXCLUDED_API", token: "globalThis" },
    { name: "global", source: "global.x;", code: "E_EXCLUDED_API", token: "global" },
    { name: "Math.random", source: "Math.random();", code: "E_EXCLUDED_API", token: "Math.random" },
    { name: "Math.sin", source: "Math.sin(1);", code: "E_EXCLUDED_API", token: "Math.sin" },
    { name: "Math.PI", source: "Math.PI;", code: "E_EXCLUDED_API", token: "Math.PI" },
    { name: "process.exit", source: "process.exit(1);", code: "E_EXCLUDED_API", token: "process.exit" },
    { name: "process.argv", source: "process.argv;", code: "E_EXCLUDED_API", token: "process.argv" },
    { name: "console.table", source: "console.table(1);", code: "E_NOT_YET_SUPPORTED", token: "console.table" },
    { name: "Object.assign", source: "Object.assign({}, {});", code: "E_NOT_YET_SUPPORTED", token: "Object.assign" },
    { name: "Promise.withResolvers", source: "Promise.withResolvers();", code: "E_NOT_YET_SUPPORTED", token: "Promise.withResolvers" },
    { name: "String.fromCharCode", source: "String.fromCharCode(65);", code: "E_NOT_YET_SUPPORTED", token: "String.fromCharCode" },
    { name: "Array.isArray", source: "Array.isArray([]);", code: "E_NOT_YET_SUPPORTED", token: "Array.isArray" },
    { name: "JSON", source: "JSON.stringify(1);", code: "E_NOT_YET_SUPPORTED", token: "JSON" },
    { name: "parseInt", source: "parseInt('1');", code: "E_NOT_YET_SUPPORTED", token: "parseInt" },
    { name: "Map", source: "new Map();", code: "E_NOT_YET_SUPPORTED", token: "Map" },
    { name: "Buffer", source: "Buffer.from('x');", code: "E_NOT_YET_SUPPORTED", token: "Buffer" },
  ];
  for (const c of cases) it(c.name, () => expectSingle(c));

  it("allows the supported globals and members", () => {
    const source = [
      "Math.abs(-1); Math.ceil(1.2); Math.floor(1.2); Math.max(1, 2); Math.min(1, 2);",
      "Math.round(1.5); Math.sign(-3); Math.sqrt(4); Math.trunc(1.9);",
      "process.nextTick(function () {});",
      "console.log(1); console.error(1); console.warn(1);",
      "Object.keys({});",
      "Promise.resolve(1); Promise.reject(1); Promise.all([]); Promise.race([]); Promise.allSettled([]); Promise.any([]);",
      "new Promise(function (resolve) { resolve(1); });",
      "String(1); Number('2'); Boolean(0); Array(3); new Array(3);",
      "[1, 2].map(String);",
      "new Error('x'); new TypeError('x'); new RangeError('x'); new ReferenceError('x'); new SyntaxError('x');",
      "new AggregateError([], 'x');",
      "const t = setTimeout(function () {}, 1); clearTimeout(t);",
      "const i = setInterval(function () {}, 1); clearInterval(i);",
      "const im = setImmediate(function () {}); clearImmediate(im);",
      "queueMicrotask(function () {});",
      "typeof Math; typeof console; typeof undeclaredName;",
      "undefined; NaN; Infinity;",
    ].join("\n");
    expect(diagnose(source)).toEqual([]);
  });

  it("names Node does not define are not refused: using one is a real ReferenceError", () => {
    expect(diagnose("notAGlobal; notAGlobal2 = 1; typeof notAGlobal3;")).toEqual([]);
  });

  it("reports each excluded reference separately", () => {
    const d = diagnose("Date.now(); Math.random();");
    expect(d.map((x) => x.range.start)).toEqual([0, 12]);
  });
});

describe("evasion by aliasing (resolved through scope analysis, not matched by syntax)", () => {
  const refused: { name: string; source: string; token: string; code?: DiagnosticCode }[] = [
    { name: "member alias", source: "const r = Math.random; r();", token: "Math.random" },
    { name: "computed constant key", source: "Math['random']();", token: "Math['random']" },
    { name: "template-literal key", source: "Math[`random`]();", token: "Math[`random`]" },
    { name: "computed variable key", source: "const k = 'random'; Math[k]();", token: "Math[k]" },
    { name: "namespace alias", source: "const M = Math; M.random();", token: "Math" },
    { name: "namespace alias on assignment", source: "let M; M = process;", token: "process" },
    { name: "namespace passed as argument", source: "function f(o) {} f(console);", token: "console" },
    { name: "globalThis member", source: "globalThis.Date;", token: "globalThis" },
    { name: "top-level this member", source: "this.Date;", token: "this.Date" },
    { name: "this member, computed", source: "this['Function'];", token: "this['Function']" },
    { name: "indirect eval", source: "(0, eval)('1');", token: "eval" },
    { name: "parameter default", source: "function f(d = Date) {}", token: "Date" },
    { name: "excluded global in a nested function", source: "function a() { return () => Symbol; }", token: "Symbol" },
    { name: "Function through .constructor", source: "(function () {}).constructor('return 1');", token: "constructor" },
  ];
  for (const c of refused) {
    it(`refuses: ${c.name}`, () => {
      const d = diagnose(c.source);
      expect(d.length, JSON.stringify(d)).toBeGreaterThanOrEqual(1);
      expect(text(c.source, d[0])).toBe(c.token);
    });
  }

  it("refuses destructuring an excluded member out of a namespace", () => {
    const d = diagnose("const {random} = Math;");
    expect(d.length).toBeGreaterThanOrEqual(1);
    expect(d.some((x) => x.code === "E_NOT_YET_SUPPORTED")).toBe(true);
  });

  it("allows a local binding that shadows an excluded global", () => {
    expect(diagnose("function f(Date) { return Date; }")).toEqual([]);
    expect(diagnose("let Symbol = 1; Symbol;")).toEqual([]);
    expect(diagnose("var Date = Date;")).toEqual([]);
    expect(diagnose("function g() { const Math = { random: 1 }; return Math.random; }")).toEqual([]);
    expect(diagnose("try {} catch (eval) { eval; }")).toEqual([]);
  });

  it("only the shadowed scope is exempt", () => {
    const source = "function f(Date) { return Date; }\nDate;";
    const d = diagnose(source);
    expect(d).toHaveLength(1);
    expect(d[0]?.range.start).toBe(source.lastIndexOf("Date"));
  });
});

describe("the CommonJS wrapper values", () => {
  it("allows module.exports, exports, this and typeof on the host-dependent ones", () => {
    const source = [
      "module.exports = { a: 1 };",
      "module.exports.b = 2;",
      "exports.c = 3;",
      "this.d = 4;",
      "console.log(typeof require, typeof module, typeof exports, typeof __filename, typeof __dirname);",
    ].join("\n");
    expect(diagnose(source)).toEqual([]);
  });

  it("refuses calling require", () => {
    const source = "const fs = require('fs');";
    const d = diagnose(source);
    expect(d).toHaveLength(1);
    expect(d[0]?.code).toBe("E_EXCLUDED_API");
    expect(text(source, d[0])).toBe("require");
  });

  it("refuses reading __filename and __dirname", () => {
    expect(diagnose("__filename;")[0]?.code).toBe("E_EXCLUDED_API");
    expect(diagnose("__dirname;")[0]?.code).toBe("E_EXCLUDED_API");
  });

  it("refuses module members other than exports, and aliasing module", () => {
    expect(text("module.id;", diagnose("module.id;")[0])).toBe("module.id");
    expect(diagnose("const m = module;")[0]?.code).toBe("E_EXCLUDED_API");
  });

  it("a local binding named require is the user's own", () => {
    expect(diagnose("function f(require) { return require('x'); }")).toEqual([]);
    expect(diagnose("function g() { const module = {}; return module.id; }")).toEqual([]);
  });
});

describe("limits", () => {
  const limits = (s: string) => checkSourceLimits(s);

  it("accepts a source of exactly 10,240 bytes and rejects one byte more", () => {
    expect(limits(`//${"a".repeat(10238)}`)).toEqual([]);
    const d = limits(`//${"a".repeat(10239)}`);
    expect(d).toHaveLength(1);
    expect(d[0]?.code).toBe("E_LIMIT_SOURCE_SIZE");
    expect(d[0]?.range).toEqual({ start: 10240, end: 10241 });
  });

  it("counts UTF-8 bytes, not code units", () => {
    expect(limits(`//${"é".repeat(5119)}`)).toEqual([]);
    expect(limits(`//${"é".repeat(5120)}`)[0]?.code).toBe("E_LIMIT_SOURCE_SIZE");
    expect(limits(`//${"😀".repeat(2560)}`)[0]?.code).toBe("E_LIMIT_SOURCE_SIZE");
  });

  it("accepts 400 lines (a trailing newline does not add one) and rejects 401", () => {
    expect(limits("1;\n".repeat(400))).toEqual([]);
    expect(limits(`${"1;\n".repeat(399)}1;`)).toEqual([]);
    const source = `${"1;\n".repeat(400)}1;`;
    const d = limits(source);
    expect(d).toHaveLength(1);
    expect(d[0]?.code).toBe("E_LIMIT_LINES");
    expect(source.slice(d[0]?.range.start, d[0]?.range.end)).toBe("1;");
  });

  it("counts CRLF and lone CR as one line break each", () => {
    expect(limits("1;\r\n".repeat(400))).toEqual([]);
    expect(limits("1;\r\n".repeat(401))[0]?.code).toBe("E_LIMIT_LINES");
    expect(limits("1;\r".repeat(401))[0]?.code).toBe("E_LIMIT_LINES");
  });

  it("validateSubset applies the limits too", () => {
    const source = `${"1;\n".repeat(400)}1;`;
    expect(diagnose(source).map((d) => d.code)).toEqual(["E_LIMIT_LINES"]);
  });
});

describe("ordering", () => {
  it("returns diagnostics sorted by position", () => {
    const d = diagnose("switch (1) {}\nDate.now();\ndebugger;");
    expect(d.map((x) => x.range.start)).toEqual([...d.map((x) => x.range.start)].sort((a, b) => a - b));
    expect(d).toHaveLength(3);
  });
});
