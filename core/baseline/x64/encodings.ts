// Closed table of x64 instruction forms, encoded per the Intel SDM vol. 2 (REX, ModRM, SIB, opcode maps).
// Only the forms Sparkplug-style baseline code needs are present; anything else is an error, never a fallback.

import { Registers, type RegisterName } from "./registers";

export type Label = { readonly id: number; readonly name: string };

export type Operand =
  | { readonly kind: "reg"; readonly reg: RegisterName }
  | { readonly kind: "imm"; readonly value: bigint }
  | { readonly kind: "mem"; readonly base: RegisterName; readonly disp: number }
  | { readonly kind: "label"; readonly label: Label };

// Condition-code suffixes in SDM order: the cc nibble is the index (jcc short = 0x70+cc, near = 0F 80+cc).
export const CONDITION_CODES = ["o", "no", "b", "ae", "e", "ne", "be", "a", "s", "ns", "p", "np", "l", "ge", "le", "g"] as const;
export type ConditionCode = (typeof CONDITION_CODES)[number];

export type JccMnemonic = `j${ConditionCode}`;
// The l/w/b mnemonics are the AT&T width-suffixed spellings (V8 assembler: addl, cmpw, movb, testb); the q forms are implicit.
export type Mnemonic = "push" | "pop" | "mov" | "lea" | "cmp" | "test" | "jmp" | "call" | "ret" | "addl" | "cmpw" | "movb" | "testb" | "int3" | JccMnemonic;

// r8b: a register with a REX-free byte form (al, cl, dl, bl, r8b..r15b); spl/bpl/sil/dil would need a bare REX, which the encoder never emits.
export type OperandPattern =
  | "r64"
  | "m64"
  | "m32"
  | "m16"
  | "m8"
  | "rm64"
  | "rax"
  | "al"
  | "r8b"
  | "imm8"
  // A byte immediate of an instruction that does not sign-extend it (TEST r/m8, imm8): -128..255 all fit one byte.
  | "imm8b"
  | "imm16"
  | "imm32"
  | "imm64"
  | "rel8"
  | "rel32";

export type Form = {
  readonly mnemonic: Mnemonic;
  readonly operands: readonly OperandPattern[];
  readonly rexW: boolean;
  // Legacy prefix bytes before REX (0x66 selects 16-bit operand size).
  readonly prefix?: readonly number[];
  readonly opcode: readonly number[];
  // ModRM byte: `reg` is an operand index or an opcode extension digit (/n); `rm` is an operand index.
  readonly modrm?: { readonly reg: number | { readonly ext: number }; readonly rm: number };
  // Register encoded in the low 3 opcode bits (push/pop/movabs); the operand index.
  readonly plusReg?: number;
};

const INT8_MIN = -128n;
const INT8_MAX = 127n;
const INT32_MIN = -(2n ** 31n);
const INT32_MAX = 2n ** 31n - 1n;
const INT64_MIN = -(2n ** 63n);
const UINT64_MAX = 2n ** 64n - 1n;

export function fitsInt8(v: bigint): boolean {
  return v >= INT8_MIN && v <= INT8_MAX;
}
export function fitsByte(v: bigint): boolean {
  return v >= INT8_MIN && v <= 255n;
}
export function fitsInt32(v: bigint): boolean {
  return v >= INT32_MIN && v <= INT32_MAX;
}
export function fitsInt16(v: bigint): boolean {
  return v >= -(2n ** 15n) && v <= 2n ** 16n - 1n;
}
function fitsImm64(v: bigint): boolean {
  return v >= INT64_MIN && v <= UINT64_MAX;
}

const JCC_FORMS: Form[] = CONDITION_CODES.flatMap((cc, n): Form[] => {
  const mnemonic: JccMnemonic = `j${cc}`;
  return [
    { mnemonic, operands: ["rel8"], rexW: false, opcode: [0x70 + n] },
    { mnemonic, operands: ["rel32"], rexW: false, opcode: [0x0f, 0x80 + n] },
  ];
});

// First match wins: narrower immediates and the rax short form precede the general ones.
export const FORMS: readonly Form[] = [
  { mnemonic: "push", operands: ["r64"], rexW: false, opcode: [0x50], plusReg: 0 },
  { mnemonic: "pop", operands: ["r64"], rexW: false, opcode: [0x58], plusReg: 0 },
  { mnemonic: "mov", operands: ["rm64", "r64"], rexW: true, opcode: [0x89], modrm: { reg: 1, rm: 0 } },
  { mnemonic: "mov", operands: ["r64", "m64"], rexW: true, opcode: [0x8b], modrm: { reg: 0, rm: 1 } },
  { mnemonic: "mov", operands: ["r64", "imm32"], rexW: true, opcode: [0xc7], modrm: { reg: { ext: 0 }, rm: 0 } },
  { mnemonic: "mov", operands: ["r64", "imm64"], rexW: true, opcode: [0xb8], plusReg: 0 },
  // REX.W 8D /r (Intel SDM, LEA), for the slot address MacroAssembler::RecordWriteField hands the write barrier.
  { mnemonic: "lea", operands: ["r64", "m64"], rexW: true, opcode: [0x8d], modrm: { reg: 0, rm: 1 } },
  { mnemonic: "cmp", operands: ["rm64", "r64"], rexW: true, opcode: [0x39], modrm: { reg: 1, rm: 0 } },
  { mnemonic: "cmp", operands: ["r64", "m64"], rexW: true, opcode: [0x3b], modrm: { reg: 0, rm: 1 } },
  { mnemonic: "cmp", operands: ["rm64", "imm8"], rexW: true, opcode: [0x83], modrm: { reg: { ext: 7 }, rm: 0 } },
  { mnemonic: "cmp", operands: ["rax", "imm32"], rexW: true, opcode: [0x3d] },
  { mnemonic: "cmp", operands: ["rm64", "imm32"], rexW: true, opcode: [0x81], modrm: { reg: { ext: 7 }, rm: 0 } },
  { mnemonic: "test", operands: ["rm64", "r64"], rexW: true, opcode: [0x85], modrm: { reg: 1, rm: 0 } },
  // REX.W A9 id (Intel SDM, TEST RAX, imm32): the short accumulator form, one byte shorter than F7 /0 (the assembler picks it for rax).
  { mnemonic: "test", operands: ["rax", "imm32"], rexW: true, opcode: [0xa9] },
  // REX.W F7 /0 id (Intel SDM, TEST), the Smi-tag test of MacroAssembler::JumpIfSmi.
  { mnemonic: "test", operands: ["rm64", "imm32"], rexW: true, opcode: [0xf7], modrm: { reg: { ext: 0 }, rm: 0 } },
  // FF /6 (Intel SDM, PUSH r/m64), for CallRuntime pushing FunctionOperand straight from the frame.
  { mnemonic: "push", operands: ["m64"], rexW: false, opcode: [0xff], modrm: { reg: { ext: 6 }, rm: 0 } },
  // 83 /0 ib and 81 /0 id without REX.W (Intel SDM, ADD r/m32), for the int32 FeedbackCell::interrupt_budget.
  { mnemonic: "addl", operands: ["m32", "imm8"], rexW: false, opcode: [0x83], modrm: { reg: { ext: 0 }, rm: 0 } },
  { mnemonic: "addl", operands: ["m32", "imm32"], rexW: false, opcode: [0x81], modrm: { reg: { ext: 0 }, rm: 0 } },
  // 66 83 /7 ib and 66 81 /7 iw (Intel SDM, CMP r/m16), MacroAssembler::CmpInstanceType on Map::instance_type.
  { mnemonic: "cmpw", operands: ["m16", "imm8"], rexW: false, prefix: [0x66], opcode: [0x83], modrm: { reg: { ext: 7 }, rm: 0 } },
  { mnemonic: "cmpw", operands: ["m16", "imm16"], rexW: false, prefix: [0x66], opcode: [0x81], modrm: { reg: { ext: 7 }, rm: 0 } },
  // 8A /r (Intel SDM, MOV r8, r/m8), BaselineAssembler::LoadWord8Field.
  { mnemonic: "movb", operands: ["r8b", "m8"], rexW: false, opcode: [0x8a], modrm: { reg: 0, rm: 1 } },
  // A8 ib and F6 /0 ib (Intel SDM, TEST AL/r/m8, imm8), MacroAssembler::CheckSmi and BaselineAssembler::TestAndBranch.
  { mnemonic: "testb", operands: ["al", "imm8b"], rexW: false, opcode: [0xa8] },
  { mnemonic: "testb", operands: ["r8b", "imm8b"], rexW: false, opcode: [0xf6], modrm: { reg: { ext: 0 }, rm: 0 } },
  // 6A ib and 68 id (Intel SDM, PUSH imm8/imm32, sign-extended), MacroAssembler::Push(Immediate) for Smi and int32 builtin arguments.
  { mnemonic: "push", operands: ["imm8"], rexW: false, opcode: [0x6a] },
  { mnemonic: "push", operands: ["imm32"], rexW: false, opcode: [0x68] },
  // REX.W C7 /0 id with a memory operand (Intel SDM, MOV r/m64, imm32), MacroAssembler::StoreTaggedSignedField.
  { mnemonic: "mov", operands: ["m64", "imm32"], rexW: true, opcode: [0xc7], modrm: { reg: { ext: 0 }, rm: 0 } },
  // CC (Intel SDM, INT3), MacroAssembler::Trap / DebugBreak after calls that never return.
  { mnemonic: "int3", operands: [], rexW: false, opcode: [0xcc] },
  { mnemonic: "jmp", operands: ["rel8"], rexW: false, opcode: [0xeb] },
  { mnemonic: "jmp", operands: ["rel32"], rexW: false, opcode: [0xe9] },
  // Indirect FF /4, for BaselineCompiler::TailCallBuiltin through the builtin entry table.
  { mnemonic: "jmp", operands: ["m64"], rexW: false, opcode: [0xff], modrm: { reg: { ext: 4 }, rm: 0 } },
  ...JCC_FORMS,
  { mnemonic: "call", operands: ["m64"], rexW: false, opcode: [0xff], modrm: { reg: { ext: 2 }, rm: 0 } },
  { mnemonic: "ret", operands: [], rexW: false, opcode: [0xc3] },
];

function isMemValid(op: Extract<Operand, { kind: "mem" }>): boolean {
  return Number.isInteger(op.disp) && fitsInt32(BigInt(op.disp));
}

export function operandMatches(pattern: OperandPattern, op: Operand): boolean {
  switch (pattern) {
    case "r64":
      return op.kind === "reg";
    case "rax":
      return op.kind === "reg" && op.reg === "rax";
    case "m64":
    case "m32":
    case "m16":
    case "m8":
      return op.kind === "mem" && isMemValid(op);
    case "al":
      return op.kind === "reg" && op.reg === "rax";
    case "r8b":
      return op.kind === "reg" && (Registers[op.reg] < 4 || Registers[op.reg] >= 8);
    case "rm64":
      return op.kind === "reg" || (op.kind === "mem" && isMemValid(op));
    case "imm8":
      return op.kind === "imm" && fitsInt8(op.value);
    case "imm8b":
      return op.kind === "imm" && fitsByte(op.value);
    case "imm16":
      return op.kind === "imm" && fitsInt16(op.value);
    case "imm32":
      return op.kind === "imm" && fitsInt32(op.value);
    case "imm64":
      return op.kind === "imm" && fitsImm64(op.value);
    case "rel8":
    case "rel32":
      return op.kind === "label";
  }
}

/** The first form matching the operands; `relBytes` picks rel8 vs rel32 for branches. Undefined means no such form. */
export function findForm(mnemonic: Mnemonic, operands: readonly Operand[], relBytes: 1 | 4 = 1): Form | undefined {
  return FORMS.find(
    (f) =>
      f.mnemonic === mnemonic &&
      f.operands.length === operands.length &&
      f.operands.every((p, i) => {
        const op = operands[i];
        if (op === undefined) return false;
        if (p === "rel8" && relBytes !== 1) return false;
        if (p === "rel32" && relBytes !== 4) return false;
        return operandMatches(p, op);
      }),
  );
}
