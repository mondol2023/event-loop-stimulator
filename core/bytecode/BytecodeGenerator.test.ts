import { describe, expect, it } from "vitest";
import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { generateBytecode } from "./BytecodeGenerator";
import { toPrintable } from "./BytecodeProgram";
import { printBytecodeArray } from "./printer";

function generate(source: string) {
  const parsed = parseScript(source);
  if (!parsed.ok) throw new Error(`test source does not parse: ${parsed.error[0]?.message}`);
  return generateBytecode(parsed.value, analyzeScopes(parsed.value));
}

describe("generateBytecode: the wrapper function", () => {
  it("compiles an empty script to the CommonJS wrapper returning undefined", () => {
    const result = generate("");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.functions).toHaveLength(1);
    const [wrapper] = result.value.functions;
    expect(wrapper).toMatchObject({ id: 0, name: "", parameterCount: 6, registerCount: 0, frameSize: 0, children: [] });
    expect(printBytecodeArray(toPrintable(wrapper!)).instructions).toEqual([
      { offset: 0, text: "LdaUndefined" },
      { offset: 1, position: { at: 0, kind: "S" }, text: "Return" },
    ]);
  });

  it("puts the final Return on the last character of the source, as V8 does", () => {
    // empty-script.cjs: an 89-byte file with a comment and a newline; V8 puts Return at 88.
    const source = `// ${"x".repeat(85)}\n`;
    expect(source).toHaveLength(89);
    const result = generate(source);
    if (!result.ok) throw new Error("unexpected diagnostics");
    const printed = printBytecodeArray(toPrintable(result.value.functions[0]!));
    expect(printed.instructions.at(-1)).toEqual({ offset: 1, position: { at: 88, kind: "S" }, text: "Return" });
  });

  it("treats whitespace and comments like an empty script", () => {
    const result = generate("  /* nothing */\n\n// still nothing\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.functions).toHaveLength(1);
    expect(result.value.functions[0]?.array.length).toBe(2);
  });
});

describe("generateBytecode: what it cannot compile yet", () => {
  it("answers with E_NOT_YET_SUPPORTED naming the construct and its range", () => {
    const result = generate("let a = 1;");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(1);
    expect(result.error[0]).toMatchObject({ code: "E_NOT_YET_SUPPORTED", range: { start: 0, end: 10 } });
    expect(result.error[0]?.message).toContain("VariableDeclaration");
    expect(result.error[0]?.hint.length).toBeGreaterThan(0);
  });

  it("does not throw on any statement", () => {
    for (const source of ["a();", "if (a) {}", "for (;;) {}", "function f() {}", "try {} catch (e) {}", "return;", "{}"]) {
      expect(() => generate(source), source).not.toThrow();
    }
  });
});
