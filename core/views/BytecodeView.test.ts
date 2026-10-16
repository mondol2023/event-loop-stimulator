import { describe, expect, it } from "vitest";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { sourceRangeForPos } from "./types";

const SOURCE = "function add(a, b) { return a + b; }\nconsole.log(add(1, 2));\n";

describe("BytecodeView", () => {
  const result = new CompilationManager().compile(SOURCE, "js");
  if (!result.views || !result.program) throw new Error("not compiled");
  const { program } = result;
  const bytecode = result.views.bytecode;
  const add = bytecode.functions[1];
  if (!add) throw new Error("no add");

  it("has one section per function, the wrapper first", () => {
    expect(bytecode.functions.map((f) => f.functionId)).toEqual(program.functions.map((f) => f.id));
    expect(bytecode.functions.map((f) => f.name)).toEqual(["", "add"]);
  });

  it("has one line per instruction, in the listing's instruction text", () => {
    expect(add.lines.map((l) => l.text)).toEqual(["Ldar a1", "Add a0, [0]", "Return"]);
  });

  it("ties each line to its own bytecode offset", () => {
    expect(add.lines.map((l) => l.positions)).toEqual([
      [{ functionId: 1, bytecodeOffset: 0 }],
      [{ functionId: 1, bytecodeOffset: 2 }],
      [{ functionId: 1, bytecodeOffset: 5 }],
    ]);
  });

  it("summarises the header and constant pool", () => {
    const wrapper = bytecode.functions[0];
    expect(wrapper?.header.parameterCount).toBe(6);
    expect(wrapper?.constantPool.some((e) => e.includes("SharedFunctionInfo add"))).toBe(true);
  });

  it("carries the source position V8 would print on a line", () => {
    const first = add.lines[0];
    expect(first?.sourcePosition?.kind).toBe("S");
    const pos = first?.positions[0];
    if (!pos) throw new Error("no position");
    expect(first?.sourcePosition?.at).toBe(sourceRangeForPos(program, pos)?.start);
    expect(add.lines[1]?.sourcePosition?.kind).toBe("E");
  });
});
