// Text forms of an Instruction: AT&T matches `llvm-mc` output, Intel matches its `-output-asm-variant=1`.

import { fitsInt32, type Operand } from "./encodings";
import type { Instruction } from "./Encoder";

export type Syntax = "att" | "intel";

// The B8+rd imm64 form is spelled movabs; every other mov takes an imm32 (Form selection stays in encodings.ts).
function isMovabs(ins: Instruction): boolean {
  const [dst, src] = ins.operands;
  return ins.mnemonic === "mov" && dst?.kind === "reg" && src?.kind === "imm" && !fitsInt32(src.value);
}

function att(op: Operand, indirect: boolean): string {
  switch (op.kind) {
    case "reg":
      return `%${op.reg}`;
    case "imm":
      return `$${op.value}`;
    case "mem":
      return `${indirect ? "*" : ""}${op.disp === 0 ? "" : op.disp}(%${op.base})`;
    case "label":
      return op.label.name;
  }
}

function intel(op: Operand, sized: boolean): string {
  switch (op.kind) {
    case "reg":
      return op.reg;
    case "imm":
      return `${op.value}`;
    case "mem":
      return `${sized ? "qword ptr " : ""}[${op.base}${op.disp === 0 ? "" : op.disp < 0 ? ` - ${-op.disp}` : ` + ${op.disp}`}]`;
    case "label":
      return op.label.name;
  }
}

// llvm-mc prints the 64-bit q suffix on these (callq/retq included); branches take none.
const ATT_SUFFIXED = new Set(["push", "pop", "mov", "lea", "cmp", "test", "call", "ret"]);

export function formatInstruction(ins: Instruction, syntax: Syntax = "att"): string {
  const movabs = isMovabs(ins);
  if (syntax === "intel") {
    const name = movabs ? "movabs" : ins.mnemonic;
    return ins.operands.length === 0 ? name : `${name} ${ins.operands.map((o) => intel(o, ins.mnemonic !== "lea")).join(", ")}`;
  }
  // The indirect jmp (FF /4) is spelled like the indirect call: jmpq *disp(%base).
  const indirect = ins.mnemonic === "call" || (ins.mnemonic === "jmp" && ins.operands[0]?.kind === "mem");
  const name = movabs ? "movabsq" : ATT_SUFFIXED.has(ins.mnemonic) || indirect ? `${ins.mnemonic}q` : ins.mnemonic;
  // AT&T lists sources first, so the Intel destination-first order is reversed.
  const ops = ins.operands.map((o) => att(o, indirect)).reverse();
  return ops.length === 0 ? name : `${name} ${ops.join(", ")}`;
}
