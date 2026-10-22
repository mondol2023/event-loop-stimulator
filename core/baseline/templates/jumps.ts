// Jumps and Return, after V8's src/baseline/baseline-compiler.cc (JumpIfRoot, BuildForwardJumpLabel, UpdateInterruptBudgetAndJumpToLabel,
// VisitJumpLoop, VisitReturn) and src/baseline/x64/baseline-assembler-x64-inl.h (AddToInterruptBudgetAndJumpIfNotExceeded).

import type { Instruction as BytecodeInstruction } from "../../bytecode/BytecodeArray";
import { imm, labelRef, mem, reg, type Label } from "../x64/Encoder";
import { RegisterRoles } from "../x64/registers";
import { BaselineFrame, epilogue, registerOperand } from "../frame";
import { rootSlot } from "../isolateData";
import { asm, bind, callRuntime, numericOperand, type Emit, type Template, type TemplateInput } from "../Template";
import { ACC, InstanceTypes, jcc, jumpIfObjectType, jumpIfSmi, jumpIfToBoolean, SCRATCH } from "./checks";
import { loadContext } from "./contexts";

function jumpTarget(bytecode: BytecodeInstruction): number {
  if (bytecode.jumpTarget === undefined) throw new Error(`${bytecode.opcode} has no jump target`);
  return bytecode.jumpTarget;
}

// BuildForwardJumpLabel + Jump: the *Constant forms jump the same way, only the operand encoding differs.
const jumpToTarget = ({ bytecode, labels }: TemplateInput): Emit => asm("jmp", [labelRef(labels.at(jumpTarget(bytecode)))]);

// JumpIfRoot(root): skip a near jcc over an unconditional jmp, so the bytecode target can be far.
function jumpIfRoot(root: string, jumpWhenEqual: boolean): Template {
  return (input) => {
    const dontJump = input.labels.local("dont_jump");
    return [
      asm("cmp", [reg(ACC), rootSlot(root)], `RootIndex::k${root}`),
      jcc(jumpWhenEqual ? "ne" : "e", dontJump),
      jumpToTarget(input),
      bind(dontJump),
    ];
  };
}

export const Jump: Template = (input) => [jumpToTarget(input)];
export const JumpIfTrue = jumpIfRoot("TrueValue", true);
export const JumpIfFalse = jumpIfRoot("FalseValue", true);
export const JumpIfNull = jumpIfRoot("NullValue", true);
export const JumpIfUndefined = jumpIfRoot("UndefinedValue", true);
export const JumpIfNotNull = jumpIfRoot("NullValue", false);
export const JumpIfNotUndefined = jumpIfRoot("UndefinedValue", false);

// VisitJumpIfToBooleanTrue/False: JumpIfToBoolean to a local dont_jump label, then the jump.
function jumpIfToBooleanTo(doJumpIfTrue: boolean): Template {
  return (input) => {
    const dontJump = input.labels.local("dont_jump");
    return [...jumpIfToBoolean(!doJumpIfTrue, dontJump), jumpToTarget(input), bind(dontJump)];
  };
}
export const JumpIfToBooleanTrue = jumpIfToBooleanTo(true);
export const JumpIfToBooleanFalse = jumpIfToBooleanTo(false);

// VisitJumpIfUndefinedOrNull.
export const JumpIfUndefinedOrNull: Template = (input) => {
  const doJump = input.labels.local("do_jump");
  const dontJump = input.labels.local("dont_jump");
  return [
    asm("cmp", [reg(ACC), rootSlot("UndefinedValue")], "RootIndex::kUndefinedValue"),
    jcc("e", doJump),
    asm("cmp", [reg(ACC), rootSlot("NullValue")], "RootIndex::kNullValue"),
    jcc("ne", dontJump),
    bind(doJump),
    jumpToTarget(input),
    bind(dontJump),
  ];
};

// VisitJumpIfJSReceiver: no static roots in Node's build, so JumpIfObjectTypeFast(kLessThan, FIRST_JS_RECEIVER_TYPE).
export const JumpIfJSReceiver: Template = (input) => {
  const isSmi = input.labels.local("is_smi");
  const dontJump = input.labels.local("dont_jump");
  return [
    ...jumpIfSmi(ACC, isSmi),
    ...jumpIfObjectType("l", ACC, InstanceTypes.FIRST_JS_RECEIVER, SCRATCH, dontJump),
    jumpToTarget(input),
    bind(isSmi),
    bind(dontJump),
  ];
};

// VisitJumpIfForInDone: JumpIfTagged(kEqual, index, RegisterFrameOperand(2)).
export const JumpIfForInDone: Template = (input) => [
  asm("mov", [reg(SCRATCH), registerOperand(numericOperand(input.bytecode, 1))], "index"),
  asm("cmp", [reg(SCRATCH), registerOperand(numericOperand(input.bytecode, 2))], "cache length"),
  jcc("e", input.labels.at(jumpTarget(input.bytecode))),
];

// Illustrative FeedbackCell layout, 8-byte tagged: map, value, dispatch_handle (int32), then interrupt_budget (int32).
const FEEDBACK_CELL_INTERRUPT_BUDGET_OFFSET = 20 - 1;

// AddToInterruptBudgetAndJumpIfNotExceeded(weight, skip): the budget is an int32 in the frame's FeedbackCell; it stays >= 0 until exhausted.
function addToInterruptBudget(weight: number, skip: Label): Emit[] {
  return [
    asm("mov", [reg(SCRATCH), mem(RegisterRoles.framePointer, BaselineFrame.feedbackCell)], "LoadFeedbackCell"),
    asm("addl", [mem(SCRATCH, FEEDBACK_CELL_INTERRUPT_BUDGET_OFFSET), imm(weight)], "FeedbackCell::interrupt_budget"),
    jcc("ge", skip),
  ];
}

// VisitJumpLoop: UpdateInterruptBudgetAndJumpToLabel(weight, label, label, kEnableStackCheck); the OSR-armed check is omitted (no optimizing tier is modelled).
export const JumpLoop: Template = ({ bytecode, labels }) => {
  const target = labels.at(jumpTarget(bytecode));
  const sizeWithoutPrefix = bytecode.size - (bytecode.scale === 1 ? 0 : 1);
  const weight = jumpTarget(bytecode) - bytecode.offset - sizeWithoutPrefix;
  return [
    ...(weight === 0 ? [] : [...addToInterruptBudget(weight, target), ...budgetInterrupt()]),
    asm("jmp", [labelRef(target)]),
  ];
};

// CallRuntime(kBytecodeBudgetInterruptWithStackCheck_Sparkplug, FunctionOperand): the closure is pushed straight from the frame.
function budgetInterrupt(): Emit[] {
  return [
    loadContext(RegisterRoles.context),
    asm("push", [mem(RegisterRoles.framePointer, BaselineFrame.function)], "FunctionOperand"),
    ...callRuntime("BytecodeBudgetInterruptWithStackCheck_Sparkplug", 1),
  ];
}

// VisitReturn: TailCallBuiltin<kBaselineLeaveFrame>(parameter_count, -profiling_weight).
export const Return: Template = (input) => epilogue(input);
