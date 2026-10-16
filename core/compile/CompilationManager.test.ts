import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CompilationManager } from "./CompilationManager";

const manager = new CompilationManager();

describe("CompilationManager.compile", () => {
  it.each(["", "   \n\t ", "// just a comment\n/* and another */"])("compiles %j to a program with only the wrapper", (source) => {
    const result = manager.compile(source, "js");
    expect(result.diagnostics).toEqual([]);
    expect(result.program?.functions).toHaveLength(1);
    expect(result.program?.functions[0]?.parameterCount).toBe(6);
    expect(result.views).toBeDefined();
  });

  it("stops at a syntax error and returns no program", () => {
    const result = manager.compile("let x; let x;", "js");
    expect(result.diagnostics.map((d) => d.code)).toEqual(["E_SYNTAX"]);
    expect(result.program).toBeUndefined();
    expect(result.views).toBeUndefined();
  });

  it("refuses an excluded API", () => {
    const result = manager.compile("Math.random()", "js");
    expect(result.diagnostics.map((d) => d.code)).toEqual(["E_EXCLUDED_API"]);
    expect(result.program).toBeUndefined();
  });

  it("refuses a source over the size limit before parsing it", () => {
    const result = manager.compile(`var s = "${"x".repeat(10_300)}";`, "js");
    expect(result.diagnostics.map((d) => d.code)).toEqual(["E_LIMIT_SOURCE_SIZE"]);
    expect(result.ast).toBeUndefined();
  });

  it("strips type annotations from TypeScript and keeps offsets", () => {
    const source = "const n: number = 1;\nconsole.log(n as number);";
    const result = manager.compile(source, "ts");
    expect(result.diagnostics).toEqual([]);
    expect(result.strippedJs).toHaveLength(source.length);
    expect(result.strippedJs).not.toContain("number");
    expect(result.program).toBeDefined();
  });

  it("reports a TypeScript construct that cannot be erased", () => {
    const result = manager.compile("enum E { A }", "ts");
    expect(result.diagnostics.map((d) => d.code)).toEqual(["E_TS_UNSUPPORTED"]);
    expect(result.program).toBeUndefined();
  });

  it("returns the intermediate results of the stages that ran", () => {
    const result = manager.compile("var a = 1;", "js");
    expect(result.strippedJs).toBe("var a = 1;");
    expect(result.ast?.type).toBe("Program");
    expect(result.scopes?.root).toBeDefined();
    expect(result.hasBom).toBe(false);
  });

  it("strips a leading BOM once: offsets are relative to the BOM-less text", () => {
    const result = manager.compile("﻿var a = 1; Math.random();", "js");
    expect(result.hasBom).toBe(true);
    expect(result.strippedJs).toBe("var a = 1; Math.random();");
    const [diagnostic] = result.diagnostics;
    expect(diagnostic?.code).toBe("E_EXCLUDED_API");
    expect(result.strippedJs?.slice(diagnostic?.range.start, diagnostic?.range.end)).toContain("Math.random");
  });

  it("only strips one BOM", () => {
    const result = manager.compile("﻿﻿var a;", "js");
    expect(result.diagnostics.map((d) => d.code)).toEqual(["E_SYNTAX"]);
  });

  it("never throws, whatever the string", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.string({ unit: "binary" }), fc.constantFrom("\0", "\uD800", "\uDFFF", "\r", " ")),
        fc.constantFrom("js" as const, "ts" as const),
        (source, lang) => {
          const result = manager.compile(source, lang);
          // A program exists exactly when nothing was reported.
          expect(result.program === undefined).toBe(result.diagnostics.length > 0);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("never throws on near-valid programs either", () => {
    const pieces = [
      "var a", " = ", "1", ";", "function f(", ") {", "}", "return", "x", "async ", "await ", "try {",
      "} catch (e) {", "} finally {", "[", "]", "{", "(", ")", "=>", "`a${", "}`", "new ", "typeof ", "?.", "??", "\n",
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...pieces), { maxLength: 24 }), (parts) => {
        const result = manager.compile(parts.join(""), "js");
        expect(result.program === undefined).toBe(result.diagnostics.length > 0);
      }),
      { numRuns: 1000 },
    );
  });
});
