// Binary operations, after V8's src/baseline/baseline-compiler.cc (BuildBinop) and BinaryOp_BaselineDescriptor
// in src/codegen/x64/interface-descriptors-x64-inl.h (lhs rdx, rhs rax, slot rbx).

import { imm, reg } from "../x64/Encoder";
import { registerOperand } from "../frame";
import { asm, callBuiltin, numericOperand, type Template } from "../Template";

// VisitAdd: CallBuiltin<kAdd_Baseline>(RegisterOperand(0), accumulator, Index(1)); rhs is already in rax.
export const Add: Template = ({ bytecode }) => [
  asm("mov", [reg("rdx"), registerOperand(numericOperand(bytecode, 0))], "lhs"),
  asm("mov", [reg("rbx"), imm(numericOperand(bytecode, 1))], "feedback slot"),
  callBuiltin("Add_Baseline"),
];
