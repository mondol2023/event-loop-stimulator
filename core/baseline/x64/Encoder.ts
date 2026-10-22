// Two-pass x64 assembler over the closed form table in encodings.ts (Intel SDM vol. 2 encodings).

import { err, ok, type Result } from "../../shared/result";
import { findForm, type Form, type Label, type Mnemonic, type Operand } from "./encodings";
import { Registers, type RegisterName } from "./registers";

export type { Label, Mnemonic, Operand } from "./encodings";

export const reg = (r: RegisterName): Operand => ({ kind: "reg", reg: r });
export const imm = (value: bigint | number): Operand => ({ kind: "imm", value: BigInt(value) });
export const mem = (base: RegisterName, disp = 0): Operand => ({ kind: "mem", base, disp });
export const labelRef = (label: Label): Operand => ({ kind: "label", label });

export type Instruction = { readonly mnemonic: Mnemonic; readonly operands: readonly Operand[] };

export type EncodeErrorCode = "E_UNKNOWN_FORM" | "E_UNBOUND_LABEL" | "E_DUPLICATE_LABEL";
// Assembler failures carry the emitted-instruction index instead of a source range, so this is not a user-source Diagnostic.
export type EncodeError = { readonly code: EncodeErrorCode; readonly message: string; readonly index: number };

export type EncodedInstruction = {
  readonly instruction: Instruction;
  readonly offset: number;
  readonly length: number;
};

export type Assembled = {
  readonly bytes: Uint8Array;
  // One entry per emitted instruction, in emit order.
  readonly instructions: readonly EncodedInstruction[];
  readonly labels: ReadonlyMap<Label, number>;
};

type Item = { readonly kind: "inst"; readonly instruction: Instruction } | { readonly kind: "bind"; readonly label: Label };

function describeOperand(op: Operand): string {
  switch (op.kind) {
    case "reg":
      return `%${op.reg}`;
    case "imm":
      return `$${op.value}`;
    case "mem":
      return `${op.disp}(%${op.base})`;
    case "label":
      return op.label.name;
  }
}

function modrmMemory(regField: number, base: RegisterName, disp: number): number[] {
  const low = Registers[base] & 7;
  // rbp/r13 as base cannot use mod=00 (that means disp32/RIP), so a zero displacement still takes a disp8.
  const mod = disp === 0 && low !== 5 ? 0 : disp >= -128 && disp <= 127 ? 1 : 2;
  const out = [(mod << 6) | ((regField & 7) << 3) | (low === 4 ? 4 : low)];
  // rsp/r12 as base need a SIB byte: scale 0, index 100 (none), base 100.
  if (low === 4) out.push(0x24);
  if (mod === 1) out.push(disp & 0xff);
  if (mod === 2) out.push(...le(BigInt(disp), 4));
  return out;
}

function le(value: bigint, bytes: number): number[] {
  const out: number[] = [];
  let v = BigInt.asUintN(bytes * 8, value);
  for (let i = 0; i < bytes; i++) {
    out.push(Number(v & 0xffn));
    v >>= 8n;
  }
  return out;
}

function regNumber(op: Operand | undefined): number {
  if (op?.kind !== "reg") throw new Error("form table invariant: expected a register operand");
  return Registers[op.reg];
}

/** Encodes one instruction; `relDisp` is the already-resolved displacement for a branch form. */
function encodeForm(form: Form, operands: readonly Operand[], relDisp: bigint): number[] {
  let rexR = 0;
  let rexB = 0;
  let regField = 0;
  let tail: number[] = [];
  let opcode = [...form.opcode];

  if (form.plusReg !== undefined) {
    const n = regNumber(operands[form.plusReg]);
    rexB = n >> 3;
    opcode = [...opcode.slice(0, -1), (opcode[opcode.length - 1] ?? 0) + (n & 7)];
  }
  if (form.modrm !== undefined) {
    if (typeof form.modrm.reg === "number") {
      const n = regNumber(operands[form.modrm.reg]);
      rexR = n >> 3;
      regField = n;
    } else {
      regField = form.modrm.reg.ext;
    }
    const rm = operands[form.modrm.rm];
    if (rm?.kind === "reg") {
      rexB = Registers[rm.reg] >> 3;
      tail = [0xc0 | ((regField & 7) << 3) | (Registers[rm.reg] & 7)];
    } else if (rm?.kind === "mem") {
      rexB = Registers[rm.base] >> 3;
      tail = modrmMemory(regField, rm.base, rm.disp);
    } else {
      throw new Error("form table invariant: ModRM r/m must be a register or memory operand");
    }
  }
  form.operands.forEach((pattern, i) => {
    const op = operands[i];
    if (op?.kind === "imm") tail.push(...le(op.value, pattern === "imm8" ? 1 : pattern === "imm16" ? 2 : pattern === "imm32" ? 4 : 8));
    if (pattern === "rel8") tail.push(...le(relDisp, 1));
    if (pattern === "rel32") tail.push(...le(relDisp, 4));
  });

  const rex = (form.rexW ? 8 : 0) | (rexR << 2) | rexB;
  return [...(form.prefix ?? []), ...(rex === 0 ? [] : [0x40 | rex]), ...opcode, ...tail];
}

export class Encoder {
  private readonly items: Item[] = [];
  private labelCount = 0;

  label(name = `L${this.labelCount}`): Label {
    return { id: this.labelCount++, name };
  }

  emit(mnemonic: Mnemonic, ...operands: Operand[]): void {
    this.items.push({ kind: "inst", instruction: { mnemonic, operands } });
  }

  bind(label: Label): void {
    this.items.push({ kind: "bind", label });
  }

  assemble(): Result<Assembled, EncodeError[]> {
    const errors: EncodeError[] = [];
    const labelItem = new Map<Label, number>(); // label -> item index it is bound before
    const insts: { instruction: Instruction; item: number; form: Form; relaxable: boolean }[] = [];
    let index = 0;

    // Pass 1: choose a form per instruction (branches start at rel8) and collect label bindings.
    this.items.forEach((item, at) => {
      if (item.kind === "bind") {
        if (labelItem.has(item.label)) {
          errors.push({ code: "E_DUPLICATE_LABEL", message: `label ${item.label.name} is bound twice`, index });
        }
        labelItem.set(item.label, at);
        return;
      }
      const { mnemonic, operands } = item.instruction;
      const form = findForm(mnemonic, operands);
      if (form === undefined) {
        errors.push({
          code: "E_UNKNOWN_FORM",
          message: `no encoding for ${mnemonic} ${operands.map(describeOperand).join(", ")}`.trimEnd(),
          index,
        });
      } else {
        insts.push({ instruction: item.instruction, item: at, form, relaxable: form.operands[0] === "rel8" });
      }
      index++;
    });
    if (errors.length > 0) return err(errors);

    const targetOf = (i: Instruction): Label => {
      const op = i.operands[0];
      if (op?.kind !== "label") throw new Error("form table invariant: branch operand must be a label");
      return op.label;
    };
    for (const [n, inst] of insts.entries()) {
      if (inst.relaxable && !labelItem.has(targetOf(inst.instruction))) {
        errors.push({ code: "E_UNBOUND_LABEL", message: `label ${targetOf(inst.instruction).name} is never bound`, index: n });
      }
    }
    if (errors.length > 0) return err(errors);

    // Relax: widen rel8 branches whose displacement overflows until no size changes (sizes only grow, so this terminates).
    const lengthOf = (inst: (typeof insts)[number]): number => encodeForm(inst.form, inst.instruction.operands, 0n).length;
    const layout = (): { offsets: number[]; labelOffsets: Map<Label, number>; total: number } => {
      const offsets: number[] = [];
      const labelOffsets = new Map<Label, number>();
      let pc = 0;
      let k = 0;
      this.items.forEach((item, at) => {
        if (item.kind === "bind") {
          labelOffsets.set(item.label, pc);
          return;
        }
        const inst = insts[k++];
        if (inst === undefined || inst.item !== at) throw new Error("assembler invariant: instruction list out of step");
        offsets.push(pc);
        pc += lengthOf(inst);
      });
      return { offsets, labelOffsets, total: pc };
    };
    for (let changed = true; changed; ) {
      changed = false;
      const { offsets, labelOffsets } = layout();
      insts.forEach((inst, n) => {
        if (!inst.relaxable) return;
        const target = labelOffsets.get(targetOf(inst.instruction)) ?? 0;
        const disp = target - ((offsets[n] ?? 0) + lengthOf(inst));
        if (disp < -128 || disp > 127) {
          const wide = findForm(inst.instruction.mnemonic, inst.instruction.operands, 4);
          if (wide === undefined) throw new Error("form table invariant: every rel8 branch has a rel32 form");
          inst.form = wide;
          inst.relaxable = false;
          changed = true;
        }
      });
    }

    // Pass 2: emit bytes with resolved displacements.
    const { offsets, labelOffsets, total } = layout();
    const bytes = new Uint8Array(total);
    const instructions: EncodedInstruction[] = [];
    insts.forEach((inst, n) => {
      const offset = offsets[n] ?? 0;
      const length = lengthOf(inst);
      const isRel = inst.form.operands[0] === "rel8" || inst.form.operands[0] === "rel32";
      const disp = isRel ? (labelOffsets.get(targetOf(inst.instruction)) ?? 0) - (offset + length) : 0;
      bytes.set(encodeForm(inst.form, inst.instruction.operands, BigInt(disp)), offset);
      instructions.push({ instruction: inst.instruction, offset, length });
    });
    return ok({ bytes, instructions, labels: labelOffsets });
  }
}
