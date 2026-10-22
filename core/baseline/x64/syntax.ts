// Text forms of an Instruction: AT&T matches `llvm-mc` output, Intel matches its `-output-asm-variant=1`.

import { fitsInt32, type Operand } from "./encodings";
import type { Instruction } from "./Encoder";

export type Syntax = "att" | "intel";

// The B8+rd imm64 form is spelled movabs; every other mov takes an imm32 (Form selection stays in encodings.ts).
function isMovabs(ins: Instruction): boolean {
  const [dst, src] = ins.operands;
  return ins.mnemonic === "mov" && dst?.kind === "reg" && src?.kind === "imm" && !fitsInt32(src.value);
}

// The sub-width forms: Intel mnemonic, memory-operand size, and whether the register operand is the 8-bit name.
const NARROW: Readonly<Record<string, { readonly intel: string; readonly ptr: string; readonly byteReg: boolean }>> = {
  addl: { intel: "add", ptr: "dword ptr", byteReg: false },
  cmpw: { intel: "cmp", ptr: "word ptr", byteReg: false },
  movb: { intel: "mov", ptr: "byte ptr", byteReg: true },
  testb: { intel: "test", ptr: "byte ptr", byteReg: true },
};

// Low-byte names of the registers the byte patterns admit (encodings.ts "r8b").
const BYTE_NAMES: Readonly<Record<string, string>> = { rax: "al", rcx: "cl", rdx: "dl", rbx: "bl" };
function byteName(reg: string): string {
  return BYTE_NAMES[reg] ?? `${reg}b`;
}

function att(op: Operand, indirect: boolean, byteReg = false): string {
  switch (op.kind) {
    case "reg":
      return `%${byteReg ? byteName(op.reg) : op.reg}`;
    case "imm":
      return `$${op.value}`;
    case "mem":
      return `${indirect ? "*" : ""}${op.disp === 0 ? "" : op.disp}(%${op.base})`;
    case "label":
      return op.label.name;
  }
}

function intel(op: Operand, ptr: string | undefined, byteReg = false): string {
  switch (op.kind) {
    case "reg":
      return byteReg ? byteName(op.reg) : op.reg;
    case "imm":
      return `${op.value}`;
    case "mem":
      return `${ptr === undefined ? "" : `${ptr} `}[${op.base}${op.disp === 0 ? "" : op.disp < 0 ? ` - ${-op.disp}` : ` + ${op.disp}`}]`;
    case "label":
      return op.label.name;
  }
}

// llvm-mc prints the 64-bit q suffix on these (callq/retq included); branches take none.
const ATT_SUFFIXED = new Set(["push", "pop", "mov", "lea", "cmp", "test", "call", "ret"]);

export function formatInstruction(ins: Instruction, syntax: Syntax = "att"): string {
  const movabs = isMovabs(ins);
  const narrow = NARROW[ins.mnemonic];
  if (syntax === "intel") {
    const name = movabs ? "movabs" : (narrow?.intel ?? ins.mnemonic);
    const ptr = narrow?.ptr ?? (ins.mnemonic === "lea" ? undefined : "qword ptr");
    return ins.operands.length === 0 ? name : `${name} ${ins.operands.map((o) => intel(o, ptr, narrow?.byteReg)).join(", ")}`;
  }
  // The indirect jmp (FF /4) is spelled like the indirect call: jmpq *disp(%base).
  const indirect = ins.mnemonic === "call" || (ins.mnemonic === "jmp" && ins.operands[0]?.kind === "mem");
  const name = movabs ? "movabsq" : ATT_SUFFIXED.has(ins.mnemonic) || indirect ? `${ins.mnemonic}q` : ins.mnemonic;
  // AT&T lists sources first, so the Intel destination-first order is reversed.
  const ops = ins.operands.map((o) => att(o, indirect, narrow?.byteReg)).reverse();
  return ops.length === 0 ? name : `${name} ${ops.join(", ")}`;
}
