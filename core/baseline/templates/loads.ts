// Accumulator and register loads and stores, globals and dynamic lookups, after V8's src/baseline/baseline-compiler.cc (Visit<Bytecode>).

import { imm, reg } from "../x64/Encoder";
import { RegisterRoles } from "../x64/registers";
import { bytecodeRegister, registerOperand } from "../frame";
import { constantHandle, rootSlot } from "../isolateData";
import { asm, callBuiltin, callRuntime, numericOperand, type Emit, type Template, type TemplateInput } from "../Template";
import { loadContext } from "./contexts";

const ACC = RegisterRoles.accumulator;

// V8's x64 Smi tagging under pointer compression: the 31-bit value shifted past the tag bit.
export const smi = (value: number): number => value * 2;
// TaggedIndex::FromIntptr: the value shifted past the tag bit, with the tag set (IndexAsTagged, UintAsTagged).
export const taggedIndex = (value: number): number => value * 2 + 1;

// BaselineCompiler::Constant<T>(i) moved into a register: Move(reg, Handle<HeapObject>).
function constant({ bytecode, fn }: TemplateInput, operand: number): bigint {
  return constantHandle(fn.id, numericOperand(bytecode, operand));
}

// VisitLdar: LoadRegister(kInterpreterAccumulatorRegister, 0).
export const Ldar: Template = ({ bytecode }) => [asm("mov", [reg(ACC), registerOperand(numericOperand(bytecode, 0))])];

// VisitLdaZero: Move(accumulator, Smi::FromInt(0)).
export const LdaZero: Template = () => [asm("mov", [reg(ACC), imm(smi(0))], "Smi 0")];

// VisitLdaSmi.
export const LdaSmi: Template = ({ bytecode }) => [asm("mov", [reg(ACC), imm(smi(numericOperand(bytecode, 0)))], "Smi")];

// VisitLda<Root>: LoadRoot(accumulator, RootIndex::k<Root>).
function loadRoot(root: string): Template {
  return () => [asm("mov", [reg(ACC), rootSlot(root)], `RootIndex::k${root}`)];
}
export const LdaUndefined = loadRoot("UndefinedValue");
export const LdaNull = loadRoot("NullValue");
export const LdaTheHole = loadRoot("TheHoleValue");
export const LdaTrue = loadRoot("TrueValue");
export const LdaFalse = loadRoot("FalseValue");

// VisitLdaConstant: LoadConstant<HeapObject>(accumulator, 0).
export const LdaConstant: Template = (input) => [asm("mov", [reg(ACC), imm(constant(input, 0))], "constant")];

// VisitStar: StoreRegister(0, accumulator).
export const Star: Template = ({ bytecode }) => [asm("mov", [registerOperand(numericOperand(bytecode, 0)), reg(ACC)])];

// SHORT_STAR_VISITOR: Register::FromShortStar maps Star<k> to local register rk.
export const ShortStar: Template = ({ bytecode }) => {
  const k = /^Star(\d+)$/.exec(bytecode.opcode)?.[1];
  if (k === undefined) throw new Error(`${bytecode.opcode} is not a short Star`);
  return [asm("mov", [bytecodeRegister(Number(k)), reg(ACC)])];
};

// VisitMov: through a scratch register (ScratchRegisterScope hands out r8 first, baseline-assembler-x64-inl.h).
export const Mov: Template = ({ bytecode }) => [
  asm("mov", [reg("r8"), registerOperand(numericOperand(bytecode, 0))]),
  asm("mov", [registerOperand(numericOperand(bytecode, 1)), reg("r8")]),
];

// VisitLdaGlobal: LoadGlobalICBaseline(name, slot) in LoadGlobalBaselineDescriptor's default registers rax, rbx.
function loadGlobal(builtin: string): Template {
  return (input) => [
    asm("mov", [reg("rax"), imm(constant(input, 0))], "name"),
    asm("mov", [reg("rbx"), imm(taggedIndex(numericOperand(input.bytecode, 1)))], "IndexAsTagged(1)"),
    callBuiltin(builtin),
  ];
}
export const LdaGlobal = loadGlobal("LoadGlobalICBaseline");
// VisitLdaGlobalInsideTypeof.
export const LdaGlobalInsideTypeof = loadGlobal("LoadGlobalICInsideTypeofBaseline");

// VisitStaGlobal: StoreGlobalICBaseline(name, value, slot) in rax, rbx, rcx; the value moves out of rax before the name lands.
export const StaGlobal: Template = (input) => [
  asm("mov", [reg("rbx"), reg(ACC)], "value"),
  asm("mov", [reg("rax"), imm(constant(input, 0))], "name"),
  asm("mov", [reg("rcx"), imm(taggedIndex(numericOperand(input.bytecode, 1)))], "IndexAsTagged(1)"),
  callBuiltin("StoreGlobalICBaseline"),
];

// BaselineCompiler::CallRuntime: LoadContext(rsi), push the arguments, then MacroAssembler::CallRuntime.
function runtimeWithName(runtime: string, input: TemplateInput, withAccumulator: boolean): Emit[] {
  return [
    loadContext(RegisterRoles.context),
    asm("mov", [reg(RegisterRoles.scratch), imm(constant(input, 0))], "name"),
    asm("push", [reg(RegisterRoles.scratch)]),
    ...(withAccumulator ? [asm("push", [reg(ACC)], "value")] : []),
    ...callRuntime(runtime, withAccumulator ? 2 : 1),
  ];
}

// VisitLdaLookupSlot and its InsideTypeof twin.
function lookupSlotRuntime(runtime: string): Template {
  return (input) => runtimeWithName(runtime, input, false);
}
export const LdaLookupSlot = lookupSlotRuntime("LoadLookupSlot");
export const LdaLookupSlotInsideTypeof = lookupSlotRuntime("LoadLookupSlotInsideTypeof");

// VisitLdaLookup{Context,ScriptContext,Global}Slot*: Lookup*Baseline(name, depth, slot) in rax, rbx, rcx.
function lookupSlotBuiltin(builtin: string): Template {
  return (input) => [
    asm("mov", [reg("rax"), imm(constant(input, 0))], "name"),
    asm("mov", [reg("rbx"), imm(taggedIndex(numericOperand(input.bytecode, 2)))], "UintAsTagged(2)"),
    asm("mov", [reg("rcx"), imm(taggedIndex(numericOperand(input.bytecode, 1)))], "IndexAsTagged(1)"),
    callBuiltin(builtin),
  ];
}
export const LdaLookupContextSlot = lookupSlotBuiltin("LookupContextBaseline");
export const LdaLookupScriptContextSlot = lookupSlotBuiltin("LookupScriptContextBaseline");
export const LdaLookupGlobalSlot = lookupSlotBuiltin("LookupGlobalICBaseline");
export const LdaLookupContextSlotInsideTypeof = lookupSlotBuiltin("LookupContextInsideTypeofBaseline");
export const LdaLookupScriptContextSlotInsideTypeof = lookupSlotBuiltin("LookupScriptContextInsideTypeofBaseline");
export const LdaLookupGlobalSlotInsideTypeof = lookupSlotBuiltin("LookupGlobalICInsideTypeofBaseline");

// VisitStaLookupSlot: flags bit 0 is the language mode (strict), bit 1 the hoisting mode (interpreter::StoreLookupSlotFlags).
export const StaLookupSlot: Template = (input) => {
  const flags = numericOperand(input.bytecode, 1);
  const runtime =
    (flags & 1) !== 0 ? "StoreLookupSlot_Strict" : (flags & 2) !== 0 ? "StoreLookupSlot_SloppyHoisting" : "StoreLookupSlot_Sloppy";
  return runtimeWithName(runtime, input, true);
};
