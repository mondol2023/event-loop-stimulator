import { describe, expect, it } from "vitest";
import { compileBaseline } from "@/core/baseline/BaselineCompiler";
import { imm, mem, reg, type Instruction } from "@/core/baseline/x64/Encoder";
import { CONDITION_CODES, FORMS } from "@/core/baseline/x64/encodings";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { builtinEntry } from "@/core/baseline/isolateData";
import { classifyInstruction } from "./classifyInstruction";

const ins = (mnemonic: Instruction["mnemonic"], ...operands: Instruction["operands"][number][]): Instruction => ({ mnemonic, operands });

describe("classifyInstruction", () => {
  it("writes the stack on push %rbp", () => {
    expect(classifyInstruction(ins("push", reg("rbp")))).toEqual({ alu: null, access: { kind: "write", region: "stack", operand: "stack" } });
  });

  it("fetches from code on a builtin call", () => {
    expect(classifyInstruction(ins("call", builtinEntry("Add")))).toEqual({ alu: null, access: { kind: "fetch", region: "code", operand: "code" } });
  });

  it("uses the adder for add, and reads then writes through the base register's region", () => {
    expect(classifyInstruction(ins("addl", mem("rax", 15), imm(1))).alu).toBe("add");
    expect(classifyInstruction(ins("cmp", reg("rax"), mem("rbp", -16)))).toEqual({ alu: "cmp", access: { kind: "read", region: "stack", operand: "stack" } });
    expect(classifyInstruction(ins("mov", mem("rbp", -8), reg("rax")))).toEqual({ alu: null, access: { kind: "write", region: "stack", operand: "stack" } });
    expect(classifyInstruction(ins("mov", reg("rbx"), mem("rax", -1)))).toEqual({ alu: null, access: { kind: "read", region: "young", operand: "heap" } });
    expect(classifyInstruction(ins("mov", reg("rax"), mem("r13", 64)))).toEqual({ alu: null, access: { kind: "read", region: "old", operand: "heap" } });
  });

  it("touches no memory on register-only forms and conditional jumps", () => {
    expect(classifyInstruction(ins("mov", reg("rax"), imm(4)))).toEqual({ alu: null, access: null });
    expect(classifyInstruction(ins("test", reg("rax"), imm(1)))).toEqual({ alu: "test", access: null });
    expect(classifyInstruction(ins("je", reg("rax")))).toEqual({ alu: null, access: null });
  });

  it("classifies every form the encoder's table holds", () => {
    const mnemonics = new Set(FORMS.map((f) => f.mnemonic));
    expect(mnemonics.size).toBeGreaterThan(CONDITION_CODES.length);
    for (const mnemonic of mnemonics) expect(() => classifyInstruction(ins(mnemonic, reg("rax"), reg("rbx")))).not.toThrow();
  });

  it("classifies every instruction the baseline compiler emits for a real program", () => {
    const { program } = new CompilationManager().compile("function f(a){ return a.x + 1; } console.log(f({x:1}), [1,2].length);", "js");
    if (!program) throw new Error("no program");
    let count = 0;
    for (const fn of program.functions) {
      const compiled = compileBaseline(fn);
      if (!compiled.ok) continue;
      for (const i of compiled.value.instructions) {
        classifyInstruction(i.instruction);
        count++;
      }
    }
    expect(count).toBeGreaterThan(20);
  });
});
