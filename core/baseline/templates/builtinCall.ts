// BaselineCompiler::CallBuiltin argument placement, after V8's src/baseline/baseline-compiler.cc (detail::ArgumentSettingHelper,
// MoveArgumentsForBuiltin) and src/baseline/x64/baseline-assembler-x64-inl.h (Move, Push, PushReverse).

import { imm, reg, type Operand } from "../x64/Encoder";
import { RegisterRoles, type RegisterName } from "../x64/registers";
import { registerOperand } from "../frame";
import { rootSlot } from "../isolateData";
import { asm, callBuiltin, type Emit } from "../Template";
import { smi, taggedIndex } from "./loads";
import { loadContext } from "./contexts";

const ACC = RegisterRoles.accumulator;

/** One CallBuiltin argument: how it lands in a descriptor register (Move) or on the stack (PushSingle). */
export type Arg = {
  readonly move: (into: RegisterName) => Emit[];
  readonly push: () => Emit[];
};

/** The slice of a CallInterfaceDescriptor that argument placement depends on. */
export type Descriptor = {
  /** registers() clipped to the parameter count: the register parameters, in parameter order. */
  readonly registers: readonly RegisterName[];
  /** kJS pushes the stack arguments reversed (PushReverse), kDefault in order. */
  readonly stackOrder: "default" | "js";
  /** HasContextParameter: the context is loaded into rsi after the arguments. */
  readonly context: boolean;
};

// CallInterfaceDescriptor::DefaultRegisterArray on x64; TFS and Torque stubs take these (kMaxBuiltinRegisterParams is 5 off ARM).
const DEFAULT_REGISTERS: readonly RegisterName[] = ["rax", "rbx", "rcx", "rdx", "rdi"];

/** A TFS/Torque stub: the first `paramCount` default registers, the rest on the stack. */
export function stubDescriptor(paramCount: number, context: boolean): Descriptor {
  return { registers: DEFAULT_REGISTERS.slice(0, paramCount), stackOrder: "default", context };
}

// MacroAssembler::Move(Register, Register) elides a self-move.
const moveReg = (into: RegisterName, from: RegisterName, comment?: string): Emit[] =>
  into === from ? [] : [asm("mov", [reg(into), reg(from)], comment)];

const fromOperand = (operand: Operand, comment?: string): Arg => ({
  move: (into) => [asm("mov", [reg(into), operand], comment)],
  push: () => [asm("push", [operand], comment)],
});

/** A register such as the accumulator or a ScratchRegisterScope scratch. */
export const fromRegister = (from: RegisterName, comment?: string): Arg => ({
  move: (into) => moveReg(into, from, comment),
  push: () => [asm("push", [reg(from)], comment)],
});

export const accumulator: Arg = fromRegister(ACC, "accumulator");

/** RegisterOperand(i): an interpreter register read from the frame. */
export const frameRegister = (operand: number, comment?: string): Arg => fromOperand(registerOperand(operand), comment);

/** A register list flattens into one argument per register, as CheckArgsHelper does; list[i] is the i-th register after the first. */
export const frameRegisters = (first: number, count: number): Arg[] =>
  Array.from({ length: count }, (_, i) => frameRegister(first - i));

/** RootIndex::k<root>, Move via LoadRoot and PushRoot. */
export const root = (name: string): Arg => fromOperand(rootSlot(name), `RootIndex::k${name}`);

/** MemOperand arguments such as FeedbackVector(). */
export const frameSlot = (operand: Operand, comment: string): Arg => fromOperand(operand, comment);

/** An int32/uint32 immediate (Move(Register, int32_t), Push(Immediate)). */
export const int = (value: number, comment?: string): Arg => ({
  move: (into) => [asm("mov", [reg(into), imm(value)], comment)],
  push: () => [asm("push", [imm(value)], comment)],
});

export const smiArg = (value: number, comment = "Smi"): Arg => int(smi(value), comment);
export const taggedIndexArg = (value: number, comment: string): Arg => int(taggedIndex(value), comment);

/** A Handle<HeapObject>: Move is one movabs, Push goes through kScratchRegister (MacroAssembler::Push(Handle)). */
export const handle = (value: bigint, comment: string): Arg => ({
  move: (into) => [asm("mov", [reg(into), imm(value)], comment)],
  push: () => [asm("mov", [reg(RegisterRoles.scratch), imm(value)], comment), asm("push", [reg(RegisterRoles.scratch)])],
});

/** MoveArgumentsForBuiltin then the call: register parameters first, the rest pushed, then the context if the descriptor has one. */
export function callBuiltinWith(builtin: string, descriptor: Descriptor, args: readonly Arg[]): Emit[] {
  if (args.length < descriptor.registers.length) throw new Error(`${builtin}: ${args.length} arguments for ${descriptor.registers.length} registers`);
  const registerArgs = args.slice(0, descriptor.registers.length);
  const stackArgs = args.slice(descriptor.registers.length);
  return [
    ...registerArgs.flatMap((arg, i) => arg.move(descriptor.registers[i] as RegisterName)),
    ...(descriptor.stackOrder === "js" ? [...stackArgs].reverse() : stackArgs).flatMap((arg) => arg.push()),
    ...(descriptor.context ? [loadContext(RegisterRoles.context)] : []),
    callBuiltin(builtin),
  ];
}

/** BaselineCompiler::CallRuntime's pushes: the arguments in order, after the caller has loaded the context. */
export function pushAll(args: readonly Arg[]): Emit[] {
  return args.flatMap((arg) => arg.push());
}
