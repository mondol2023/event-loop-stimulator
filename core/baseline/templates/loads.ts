// Accumulator and register loads, after V8's src/baseline/baseline-compiler.cc (Visit<Bytecode>).

import { reg } from "../x64/Encoder";
import { RegisterRoles } from "../x64/registers";
import { registerOperand } from "../frame";
import { asm, numericOperand, type Template } from "../Template";

// VisitLdar: LoadRegister(kInterpreterAccumulatorRegister, 0).
export const Ldar: Template = ({ bytecode }) => [
  asm("mov", [reg(RegisterRoles.accumulator), registerOperand(numericOperand(bytecode, 0))]),
];
