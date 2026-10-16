import { describe, expect, it } from "vitest";
import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { asFunctionId } from "@/core/shared/ids";
import { positionsForSourceRange, sourceRangeForPos } from "./types";

function compileProgram(source: string): BytecodeProgram {
  const result = new CompilationManager().compile(source, "js");
  if (!result.program) throw new Error(`not compiled: ${JSON.stringify(result.diagnostics)}`);
  return result.program;
}

const SOURCE = "function add(a, b) { return a + b; }\nvar r = add(1, 2);\nconsole.log(r);\n";

describe("source positions", () => {
  const program = compileProgram(SOURCE);

  it("maps every recorded position back to a range that contains it", () => {
    let checked = 0;
    for (const fn of program.functions) {
      for (const entry of fn.positions.entries) {
        const range = sourceRangeForPos(program, { functionId: fn.id, bytecodeOffset: entry.offset });
        expect(range, `function ${fn.id} offset ${entry.offset}`).toBeDefined();
        expect(range?.start).toBeLessThanOrEqual(entry.position);
        expect(range?.end).toBeGreaterThan(entry.position);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("gives an instruction without an entry of its own the position that precedes it", () => {
    const wrapper = program.functions[0];
    if (!wrapper) throw new Error("no wrapper");
    const instructions = wrapper.array.instructions;
    const index = instructions.findIndex((instruction, i) => {
      const next = instructions[i + 1];
      return wrapper.positions.at(instruction.offset) !== undefined && next !== undefined && wrapper.positions.at(next.offset) === undefined;
    });
    const withEntry = instructions[index];
    const next = instructions[index + 1];
    if (!withEntry || !next) throw new Error("test source must have an instruction without a position");
    const expected = wrapper.positions.at(withEntry.offset)?.position;
    expect(sourceRangeForPos(program, { functionId: wrapper.id, bytecodeOffset: next.offset })?.start).toBe(expected);
  });

  it("has no range in an unknown function", () => {
    expect(sourceRangeForPos(program, { functionId: asFunctionId(99), bytecodeOffset: 0 })).toBeUndefined();
  });

  it("finds the bytecode of a statement from its source range", () => {
    const start = SOURCE.indexOf("var r");
    const range = { start, end: SOURCE.indexOf("\n", start) };
    const found = positionsForSourceRange(program, range);
    const wrapper = program.functions[0];
    // V8 puts a variable statement's mark on the declared name or its initializer, not on `var`.
    const statementEntry = wrapper?.positions.entries.find((e) => e.kind === "statement" && e.position >= range.start && e.position < range.end);
    expect(statementEntry).toBeDefined();
    expect(found).toContainEqual({ functionId: wrapper?.id, bytecodeOffset: statementEntry?.offset });
    for (const pos of found) {
      const back = sourceRangeForPos(program, pos);
      expect(back?.start).toBeGreaterThanOrEqual(range.start);
      expect(back?.start).toBeLessThan(range.end);
    }
  });

  it("includes the bytecode of functions inside a range", () => {
    const found = positionsForSourceRange(program, { start: 0, end: SOURCE.indexOf("\n") });
    expect(found.some((p) => p.functionId !== 0)).toBe(true);
  });

  it("returns nothing for an empty or out-of-text range, and sorts otherwise", () => {
    expect(positionsForSourceRange(program, { start: 5, end: 5 })).toEqual([]);
    expect(positionsForSourceRange(program, { start: 9999, end: 10000 })).toEqual([]);
    const all = positionsForSourceRange(program, { start: 0, end: SOURCE.length });
    const sorted = [...all].sort((a, b) => a.functionId - b.functionId || a.bytecodeOffset - b.bytecodeOffset);
    expect(all).toEqual(sorted);
  });
});
