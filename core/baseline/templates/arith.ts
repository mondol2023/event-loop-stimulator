// Binary, unary and conversion operations, after V8's src/baseline/baseline-compiler.cc (Visit<Op>) and the descriptors in
// src/codegen/x64/interface-descriptors-x64-inl.h (BinaryOp_Baseline rdx, rax, rbx; BinarySmiOp_Baseline rax, rdx, rbx).

import { imm, reg } from "../x64/Encoder";
import { registerOperand } from "../frame";
import { asm, callBuiltin, numericOperand, type Template } from "../Template";
import { ACC } from "./checks";
import { smi } from "./loads";

// VisitAdd..VisitShiftRightLogical: CallBuiltin<k<Op>_Baseline>(RegisterOperand(0), accumulator, Index(1)); rhs is already in rax.
function binaryOp(builtin: string): Template {
  return ({ bytecode }) => [
    asm("mov", [reg("rdx"), registerOperand(numericOperand(bytecode, 0))], "lhs"),
    asm("mov", [reg("rbx"), imm(numericOperand(bytecode, 1))], "feedback slot"),
    callBuiltin(`${builtin}_Baseline`),
  ];
}

// VisitAddSmi..VisitShiftRightLogicalSmi: CallBuiltin<k<Op>Smi_Baseline>(accumulator, IntAsSmi(0), Index(1)); lhs is already in rax.
function binarySmiOp(builtin: string): Template {
  return ({ bytecode }) => [
    asm("mov", [reg("rdx"), imm(smi(numericOperand(bytecode, 0)))], "IntAsSmi(0)"),
    asm("mov", [reg("rbx"), imm(numericOperand(bytecode, 1))], "feedback slot"),
    callBuiltin(`${builtin}Smi_Baseline`),
  ];
}

export const Add = binaryOp("Add");
export const Sub = binaryOp("Subtract");
export const Mul = binaryOp("Multiply");
export const Div = binaryOp("Divide");
export const Mod = binaryOp("Modulus");
export const Exp = binaryOp("Exponentiate");
export const BitwiseOr = binaryOp("BitwiseOr");
export const BitwiseXor = binaryOp("BitwiseXor");
export const BitwiseAnd = binaryOp("BitwiseAnd");
export const ShiftLeft = binaryOp("ShiftLeft");
export const ShiftRight = binaryOp("ShiftRight");
export const ShiftRightLogical = binaryOp("ShiftRightLogical");

export const AddSmi = binarySmiOp("Add");
export const SubSmi = binarySmiOp("Subtract");
export const MulSmi = binarySmiOp("Multiply");
export const DivSmi = binarySmiOp("Divide");
export const ModSmi = binarySmiOp("Modulus");
export const ExpSmi = binarySmiOp("Exponentiate");
export const BitwiseOrSmi = binarySmiOp("BitwiseOr");
export const BitwiseXorSmi = binarySmiOp("BitwiseXor");
export const BitwiseAndSmi = binarySmiOp("BitwiseAnd");
export const ShiftLeftSmi = binarySmiOp("ShiftLeft");
export const ShiftRightSmi = binarySmiOp("ShiftRight");
export const ShiftRightLogicalSmi = binarySmiOp("ShiftRightLogical");

// VisitInc..VisitTypeOf, VisitToNumber, VisitToNumeric: CallBuiltin<k<Op>_Baseline>(accumulator, Index(0)), the default registers rax, rbx.
function unaryOp(builtin: string): Template {
  return ({ bytecode }) => [asm("mov", [reg("rbx"), imm(numericOperand(bytecode, 0))], "feedback slot"), callBuiltin(builtin)];
}

export const Inc = unaryOp("Increment_Baseline");
export const Dec = unaryOp("Decrement_Baseline");
export const Negate = unaryOp("Negate_Baseline");
export const BitwiseNot = unaryOp("BitwiseNot_Baseline");
export const TypeOf = unaryOp("Typeof_Baseline");
export const ToNumber = unaryOp("ToNumber_Baseline");
export const ToNumeric = unaryOp("ToNumeric_Baseline");

// VisitToName, VisitToString, VisitToBoolean: CallBuiltin<k<Op>>(accumulator); the Torque builtin takes it in rax.
function accumulatorBuiltin(builtin: string): Template {
  return () => [callBuiltin(builtin)];
}

export const ToName = accumulatorBuiltin("ToName");
export const ToString = accumulatorBuiltin("ToString");
export const ToBoolean = accumulatorBuiltin("ToBoolean");

// VisitToObject: SaveAccumulatorScope around kToObject, whose result goes to the register operand.
export const ToObject: Template = ({ bytecode }) => [
  asm("push", [reg(ACC)], "SaveAccumulatorScope"),
  callBuiltin("ToObject"),
  asm("mov", [registerOperand(numericOperand(bytecode, 0)), reg(ACC)]),
  asm("pop", [reg(ACC)]),
];
