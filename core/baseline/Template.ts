// The per-bytecode code template contract, after V8's src/baseline/baseline-compiler.cc (one Visit<Bytecode> per opcode).

import type { Instruction as BytecodeInstruction } from "../bytecode/BytecodeArray";
import type { BytecodeFunction } from "../bytecode/BytecodeProgram";
import type { Instruction, Label, Mnemonic, Operand } from "./x64/Encoder";
import { builtinEntry } from "./isolateData";

/** What a template emits: an instruction (with an optional `; comment`) or a label binding, in order. */
export type Emit =
  | { readonly kind: "inst"; readonly instruction: Instruction; readonly comment?: string }
  | { readonly kind: "bind"; readonly label: Label };

export type TemplateLabels = {
  /** The label bound before the first instruction of bytecode `offset`, as V8's `labels_[offset]`. */
  readonly at: (bytecodeOffset: number) => Label;
  /** A fresh label private to this bytecode's code, as V8's stack-allocated `Label dont_jump`. */
  readonly local: (name: string) => Label;
};

export type TemplateInput = {
  /** One decoded bytecode: a `Wide`/`ExtraWide` prefix is already folded into `scale` and the full-width operands. */
  readonly bytecode: BytecodeInstruction;
  readonly fn: BytecodeFunction;
  readonly labels: TemplateLabels;
};

/** Pure: the same input gives the same emits; label identity comes only from `labels`. */
export type Template = (input: TemplateInput) => readonly Emit[];

export type BaselineInstruction = {
  /** AT&T text of `instruction` (llvm-mc's default syntax); `formatInstruction` gives the Intel form. */
  readonly asm: string;
  /** The exact encoding of `asm`. */
  readonly bytes: readonly number[];
  /** The bytecode this instruction belongs to, or FUNCTION_ENTRY_BYTECODE_OFFSET for the prologue. */
  readonly bytecodeOffset: number;
  readonly instruction: Instruction;
  readonly comment?: string;
};

export type BaselineCode = { readonly instructions: readonly BaselineInstruction[] };

// V8's kFunctionEntryBytecodeOffset: prologue code belongs to no bytecode (builtins-x64.cc, function_entry_bytecode).
export const FUNCTION_ENTRY_BYTECODE_OFFSET = -1;

export function asm(mnemonic: Mnemonic, operands: readonly Operand[], comment?: string): Emit {
  const instruction = { mnemonic, operands };
  return comment === undefined ? { kind: "inst", instruction } : { kind: "inst", instruction, comment };
}

export function bind(label: Label): Emit {
  return { kind: "bind", label };
}

/** `call [r13 + IsolateData::builtin_entry(k<name>)]`: BuiltinCallJumpMode::kIndirect, Sparkplug's x64 fallback. */
export function callBuiltin(builtin: string): Emit {
  return asm("call", [builtinEntry(builtin)], `Builtin::k${builtin}`);
}

/** As callBuiltin, for BaselineCompiler::TailCallBuiltin. */
export function tailCallBuiltin(builtin: string): Emit {
  return asm("jmp", [builtinEntry(builtin)], `Builtin::k${builtin}`);
}

/** A bytecode's numeric operand; a name here means the table and the template disagree, a bug in core. */
export function numericOperand(bytecode: BytecodeInstruction, index: number): number {
  const value = bytecode.operands[index];
  if (typeof value !== "number") throw new Error(`${bytecode.opcode} operand ${index} is not numeric`);
  return value;
}
