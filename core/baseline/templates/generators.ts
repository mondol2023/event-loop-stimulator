// Generator and async-function suspension, after V8's src/baseline/baseline-compiler.cc (VisitSwitchOnGeneratorState,
// VisitSuspendGenerator, VisitResumeGenerator) and src/objects/js-generator.{h,tq}.

import { imm, mem, reg } from "../x64/Encoder";
import { RegisterRoles } from "../x64/registers";
import { BaselineFrame, registerOperand } from "../frame";
import { rootSlot } from "../isolateData";
import { asm, bind, numericOperand, tailCallBuiltin, type Template } from "../Template";
import { callBuiltinWith, fromRegister, int, stubDescriptor } from "./builtinCall";
import { jcc } from "./checks";
import { smi } from "./loads";

const HEAP_OBJECT_TAG = 1;

// Illustrative non-compressed JSGeneratorObject layout in js-generator.tq order, after JSObject's map, properties and elements.
export const GeneratorField = { context: 32, resumeMode: 56, continuation: 64 } as const;
// JSGeneratorObject::kGeneratorExecuting / kGeneratorClosed.
export const GeneratorState = { executing: -2, closed: -1 } as const;
// Illustrative BytecodeArray::kHeaderSize, the bias SuspendGeneratorBaseline expects on the saved bytecode offset.
const BYTECODE_ARRAY_HEADER_SIZE = 48;

// ScratchRegisterScope hands out r8, r9, r11 in turn (kScratchRegisters).
const GENERATOR = "r8";
const CONTINUATION = "r9";
const CONTEXT = "r11";

// VisitSwitchOnGeneratorState: skip when the register holds undefined, else mark the generator executing, restore its context and
// dispatch on the continuation. Simplification: no jump table (the encoder has no SIB or data), a compare chain on the tagged Smi.
export const SwitchOnGeneratorState: Template = ({ bytecode, labels }) => {
  const fallthrough = labels.local("fallthrough");
  const cases = bytecode.switchTargets ?? [];
  return [
    asm("mov", [reg(GENERATOR), registerOperand(numericOperand(bytecode, 0))], "generator object"),
    asm("cmp", [reg(GENERATOR), rootSlot("UndefinedValue")], "RootIndex::kUndefinedValue"),
    jcc("e", fallthrough),
    asm("mov", [reg(CONTINUATION), mem(GENERATOR, GeneratorField.continuation - HEAP_OBJECT_TAG)], "continuation (tagged, not untagged)"),
    asm("mov", [mem(GENERATOR, GeneratorField.continuation - HEAP_OBJECT_TAG), imm(smi(GeneratorState.executing))], "kGeneratorExecuting"),
    asm("mov", [reg(CONTEXT), mem(GENERATOR, GeneratorField.context - HEAP_OBJECT_TAG)]),
    asm("mov", [mem(RegisterRoles.framePointer, BaselineFrame.context), reg(CONTEXT)], "StoreContext"),
    ...cases.flatMap(({ caseValue, target }) => [
      asm("cmp", [reg(CONTINUATION), imm(smi(caseValue))], `case ${caseValue}`),
      jcc("e", labels.at(target)),
    ]),
    asm("int3", [], "Trap"),
    bind(fallthrough),
  ];
};

// VisitSuspendGenerator: SuspendGeneratorBaseline(generator, suspend id, bytecode offset, register count) with the accumulator saved,
// then BaselineLeaveFrame with a zero profiling weight.
export const SuspendGenerator: Template = ({ bytecode, fn }) => [
  asm("mov", [reg(GENERATOR), registerOperand(numericOperand(bytecode, 0))], "generator object"),
  asm("push", [reg(RegisterRoles.accumulator)], "SaveAccumulatorScope"),
  ...callBuiltinWith("SuspendGeneratorBaseline", stubDescriptor(4, false), [
    fromRegister(GENERATOR, "generator object"),
    int(numericOperand(bytecode, 3), "suspend id"),
    int(BYTECODE_ARRAY_HEADER_SIZE + bytecode.offset, "BytecodeArray::kHeaderSize + offset"),
    int(numericOperand(bytecode, 2), "register count"),
  ]),
  asm("pop", [reg(RegisterRoles.accumulator)]),
  asm("mov", [reg("rbx"), imm(fn.parameterCount)], "params size (BaselineLeaveFrameDescriptor)"),
  asm("mov", [reg("rcx"), imm(0)], "budget weight (BaselineLeaveFrameDescriptor)"),
  tailCallBuiltin("BaselineLeaveFrame"),
];

// VisitResumeGenerator: ResumeGeneratorBaseline(generator, register count); it returns the resumed value in rax.
export const ResumeGenerator: Template = ({ bytecode }) => [
  asm("mov", [reg(GENERATOR), registerOperand(numericOperand(bytecode, 0))], "generator object"),
  ...callBuiltinWith("ResumeGeneratorBaseline", stubDescriptor(2, false), [
    fromRegister(GENERATOR, "generator object"),
    int(numericOperand(bytecode, 2), "register count"),
  ]),
];

