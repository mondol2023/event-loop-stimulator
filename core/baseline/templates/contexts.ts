// Context loads, stores and the context chain, after V8's src/baseline/baseline-compiler.cc (Visit*ContextSlot, Push/PopContext)
// and src/baseline/x64/baseline-assembler-x64-inl.h (LdaContextSlot, StaContextSlot, StoreTaggedFieldWithWriteBarrier).

import { imm, labelRef, mem, reg, type Operand } from "../x64/Encoder";
import { RegisterRoles, type RegisterName } from "../x64/registers";
import { BaselineFrame, registerOperand } from "../frame";
import { rootSlot } from "../isolateData";
import { asm, bind, callBuiltin, numericOperand, type Emit, type Template, type TemplateInput } from "../Template";

// Illustrative Context layout with 8-byte slots (V8 compresses them to 4): map, length, then scope_info and previous.
const CONTEXT_ELEMENTS_OFFSET = 16;
const CONTEXT_PREVIOUS_OFFSET = CONTEXT_ELEMENTS_OFFSET + 8; // Context::kPreviousOffset
const HEAP_OBJECT_TAG = 1;

// FieldOperand(context, Context::OffsetOfElementAt(index)).
function slotField(base: RegisterName, index: number): Operand {
  return mem(base, CONTEXT_ELEMENTS_OFFSET + 8 * index - HEAP_OBJECT_TAG);
}

// ScratchRegisterScope::AcquireScratch hands out r8 first (baseline-assembler-x64-inl.h, kScratchRegisters).
const SCRATCH = "r8";
// WriteBarrierDescriptor::registers() for the Windows target (interface-descriptors-x64-inl.h): object rdi, slot address r8, value rcx.
const WB_OBJECT = "rdi";
const WB_SLOT = "r8";
const WB_VALUE = "rcx";

/** BaselineAssembler::LoadContext: the context lives in the frame at kContextOffset. */
export function loadContext(into: RegisterName): Emit {
  return asm("mov", [reg(into), mem(RegisterRoles.framePointer, BaselineFrame.context)], "LoadContext");
}

/** BaselineAssembler::StoreContext. */
export function storeContext(from: RegisterName): Emit {
  return asm("mov", [mem(RegisterRoles.framePointer, BaselineFrame.context), reg(from)], "StoreContext");
}

// Walks `depth` Context::previous links in place, as the TaggedRegister loops do (shown full-width; V8 loads them compressed).
function walkPrevious(context: RegisterName, depth: number): Emit[] {
  return Array.from({ length: depth }, () =>
    asm("mov", [reg(context), mem(context, CONTEXT_PREVIOUS_OFFSET - HEAP_OBJECT_TAG)], "Context::previous"),
  );
}

// StoreTaggedFieldWithWriteBarrier: the store, then RecordWriteField (Smi filter, slot address, RecordWrite builtin).
function storeWithBarrier(field: Operand, input: TemplateInput): Emit[] {
  const done = input.labels.local("done");
  return [
    asm("mov", [field, reg(WB_VALUE)]),
    asm("test", [reg(WB_VALUE), imm(1)], "JumpIfSmi(value)"),
    asm("je", [labelRef(done)]),
    asm("lea", [reg(WB_SLOT), field], "slot address"),
    callBuiltin("RecordWriteIgnoreFP"),
    bind(done),
  ];
}

// VisitPushContext: the new context (accumulator) replaces the frame's, the old one goes to the register operand.
export const PushContext: Template = ({ bytecode }) => [
  loadContext(SCRATCH),
  storeContext(RegisterRoles.accumulator),
  asm("mov", [registerOperand(numericOperand(bytecode, 0)), reg(SCRATCH)]),
];

// VisitPopContext.
export const PopContext: Template = ({ bytecode }) => [
  asm("mov", [reg(SCRATCH), registerOperand(numericOperand(bytecode, 0))]),
  storeContext(SCRATCH),
];

// VisitLdaContextSlot (VisitLdaImmutableContextSlot is the same): LoadRegister(context), then LdaContextSlot(context, index, depth).
export const LdaContextSlot: Template = ({ bytecode }) => [
  asm("mov", [reg(SCRATCH), registerOperand(numericOperand(bytecode, 0))]),
  ...walkPrevious(SCRATCH, numericOperand(bytecode, 2)),
  asm("mov", [reg(RegisterRoles.accumulator), slotField(SCRATCH, numericOperand(bytecode, 1))]),
];

// VisitLdaCurrentContextSlot (VisitLdaImmutableCurrentContextSlot is the same).
export const LdaCurrentContextSlot: Template = ({ bytecode }) => [
  loadContext(SCRATCH),
  asm("mov", [reg(RegisterRoles.accumulator), slotField(SCRATCH, numericOperand(bytecode, 0))]),
];

// The tail of the script-context loads: a mutable HeapNumber is boxed afresh (kAllocateIfMutableHeapNumberScriptContextSlot).
function allocateIfMutableHeapNumber(index: number, input: TemplateInput): Emit[] {
  const done = input.labels.local("done");
  return [
    asm("test", [reg(RegisterRoles.accumulator), imm(1)], "JumpIfSmi(accumulator)"),
    asm("je", [labelRef(done)]),
    // V8 compares the instance type with HEAP_NUMBER_TYPE; the closed form table has no 16-bit cmp, so the map is compared.
    asm("mov", [reg(RegisterRoles.scratch), mem(RegisterRoles.accumulator, -HEAP_OBJECT_TAG)], "map"),
    asm("cmp", [reg(RegisterRoles.scratch), rootSlot("HeapNumberMap")], "HEAP_NUMBER_TYPE"),
    asm("jne", [labelRef(done)]),
    // Default descriptor registers: heap number rax, context rbx, slot rcx.
    asm("mov", [reg("rbx"), reg(SCRATCH)], "context"),
    asm("mov", [reg("rcx"), imm(index * 2)], "Smi::FromInt(index)"),
    callBuiltin("AllocateIfMutableHeapNumberScriptContextSlot"),
    bind(done),
  ];
}

// VisitLdaScriptContextSlot.
export const LdaScriptContextSlot: Template = (input) => [
  ...LdaContextSlot(input),
  ...allocateIfMutableHeapNumber(numericOperand(input.bytecode, 1), input),
];

// VisitLdaCurrentScriptContextSlot.
export const LdaCurrentScriptContextSlot: Template = (input) => [
  ...LdaCurrentContextSlot(input),
  ...allocateIfMutableHeapNumber(numericOperand(input.bytecode, 0), input),
];

// VisitStaContextSlot: value into the write barrier's value register, context into its object register, then StaContextSlot.
export const StaContextSlot: Template = (input) => {
  const { bytecode } = input;
  return [
    asm("mov", [reg(WB_VALUE), reg(RegisterRoles.accumulator)], "value"),
    asm("mov", [reg(WB_OBJECT), registerOperand(numericOperand(bytecode, 0))], "context"),
    ...walkPrevious(WB_OBJECT, numericOperand(bytecode, 2)),
    ...storeWithBarrier(slotField(WB_OBJECT, numericOperand(bytecode, 1)), input),
  ];
};

// VisitStaCurrentContextSlot.
export const StaCurrentContextSlot: Template = (input) => [
  asm("mov", [reg(WB_VALUE), reg(RegisterRoles.accumulator)], "value"),
  loadContext(WB_OBJECT),
  ...storeWithBarrier(slotField(WB_OBJECT, numericOperand(input.bytecode, 0)), input),
];

// SaveAccumulatorScope: the accumulator is pushed around the call and popped back after.
function savingAccumulator(call: Emit): Emit[] {
  return [asm("push", [reg(RegisterRoles.accumulator)], "SaveAccumulatorScope"), call, asm("pop", [reg(RegisterRoles.accumulator)])];
}

// VisitStaScriptContextSlot: StoreScriptContextSlotBaseline(context, value, slot, depth) in the default registers rax, rbx, rcx, rdx.
export const StaScriptContextSlot: Template = ({ bytecode }) => [
  asm("mov", [reg("rbx"), reg(RegisterRoles.accumulator)], "value"),
  asm("mov", [reg("rax"), registerOperand(numericOperand(bytecode, 0))], "context"),
  asm("mov", [reg("rcx"), imm(numericOperand(bytecode, 1) * 2)], "IndexAsSmi(1)"),
  asm("mov", [reg("rdx"), imm(numericOperand(bytecode, 2) * 2 + 1)], "UintAsTagged(2)"),
  ...savingAccumulator(callBuiltin("StoreScriptContextSlotBaseline")),
];

// VisitStaCurrentScriptContextSlot: StoreCurrentScriptContextSlotBaseline(value, slot); the value is already in rax.
export const StaCurrentScriptContextSlot: Template = ({ bytecode }) => [
  asm("mov", [reg("rbx"), imm(numericOperand(bytecode, 0) * 2)], "IndexAsSmi(0)"),
  ...savingAccumulator(callBuiltin("StoreCurrentScriptContextSlotBaseline")),
];
