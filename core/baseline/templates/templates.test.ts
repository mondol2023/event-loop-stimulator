import { describe, expect, it } from "vitest";
import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { generateBytecode } from "@/core/bytecode/BytecodeGenerator";
import type { BytecodeFunction } from "@/core/bytecode/BytecodeProgram";
import { Encoder, mem, type Label } from "../x64/Encoder";
import { bytecodeRegister, epilogue, prologue, REGISTER_FILE_SLOT } from "../frame";
import type { Emit } from "../Template";
import { TEMPLATES } from "./index";

function compile(source: string): readonly BytecodeFunction[] {
  const parsed = parseScript(source);
  if (!parsed.ok) throw new Error(`test source does not parse: ${parsed.error[0]?.message}`);
  const result = generateBytecode(parsed.value, analyzeScopes(parsed.value));
  if (!result.ok) throw new Error(`not compiled: ${result.error[0]?.message}`);
  return result.value.functions;
}

describe("baseline frame", () => {
  // Guards the two independent sources of the frame: V8's operand numbering in bytecodes.ts and the frame constants.
  it("puts rk at [rbp - 8*(k+N)] with N = 7", () => {
    expect(REGISTER_FILE_SLOT).toBe(7);
    for (const k of [0, 1, 9]) expect(bytecodeRegister(k)).toEqual(mem("rbp", -8 * (k + REGISTER_FILE_SLOT)));
  });
});

describe("template contract", () => {
  // Guards that every emitted form exists in the closed encoder table, so Task 8 cannot hit E_UNKNOWN_FORM on these.
  it("assembles the prologue, the worked examples, the stubs and the epilogue of a real function", () => {
    const fn = compile("function f(a, b) { const s = a + b; if (a < b) return s; return b; }\nf(1, 2);")[1];
    if (fn === undefined) throw new Error("no function f");
    const encoder = new Encoder();
    const atOffset = new Map<number, Label>();
    const labels = {
      at: (offset: number): Label => {
        const label = atOffset.get(offset) ?? encoder.label(`bc${offset}`);
        atOffset.set(offset, label);
        return label;
      },
      local: (name: string): Label => encoder.label(name),
    };
    const put = (emits: readonly Emit[]): void => {
      for (const e of emits) {
        if (e.kind === "bind") encoder.bind(e.label);
        else encoder.emit(e.instruction.mnemonic, ...e.instruction.operands);
      }
    };

    put(prologue({ registerCount: fn.registerCount, frameSize: fn.frameSize, bytecodeArray: 0x1234_5679n }));
    for (const bytecode of fn.array.instructions) {
      encoder.bind(labels.at(bytecode.offset));
      // Return is still a stub; the epilogue stands in so its tail-call form is covered too.
      put(bytecode.opcode === "Return" ? epilogue({ bytecode, fn }) : TEMPLATES[bytecode.opcode]({ bytecode, fn, labels }));
    }

    const opcodes = fn.array.instructions.map((i) => i.opcode);
    expect(opcodes).toEqual(expect.arrayContaining(["Ldar", "Add", "JumpIfFalse"]));
    const assembled = encoder.assemble();
    expect(assembled.ok ? [] : assembled.error).toEqual([]);
  });
});
