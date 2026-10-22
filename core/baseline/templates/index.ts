// Opcode -> template, exhaustive by type (D3); BaselineCompiler::VisitSingleBytecode's dispatch in src/baseline/baseline-compiler.cc.

import { BYTECODES, type Opcode } from "../../bytecode/bytecodes";
import { callBuiltin, type Template } from "../Template";
import { Add } from "./arith";
import { JumpIfFalse } from "./jumps";
import { Ldar } from "./loads";

// Stub for opcodes without a template yet: Sparkplug's out-of-line shape, a call to Builtin::k<Opcode>_Baseline.
function builtinStub(opcode: Opcode): Template {
  return () => [callBuiltin(`${opcode}_Baseline`)];
}

// VisitWide/VisitExtraWide are UNREACHABLE: the iterator folds the prefix into the next bytecode's operands.
const prefix: Template = ({ bytecode }) => {
  throw new Error(`${bytecode.opcode} is a prefix and never reaches a template`);
};

const STUBS = Object.fromEntries(
  (Object.keys(BYTECODES) as Opcode[]).map((opcode) => [opcode, builtinStub(opcode)]),
) as Record<Opcode, Template>;

export const TEMPLATES = {
  ...STUBS,
  Wide: prefix,
  ExtraWide: prefix,
  Ldar,
  Add,
  JumpIfFalse,
} satisfies Record<Opcode, Template>;
