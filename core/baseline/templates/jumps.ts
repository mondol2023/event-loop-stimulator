// Jumps, after V8's src/baseline/baseline-compiler.cc (JumpIfRoot, BuildForwardJumpLabel).

import type { Instruction as BytecodeInstruction } from "../../bytecode/BytecodeArray";
import { labelRef, reg } from "../x64/Encoder";
import { RegisterRoles } from "../x64/registers";
import { rootSlot } from "../isolateData";
import { asm, bind, type Template } from "../Template";

function jumpTarget(bytecode: BytecodeInstruction): number {
  if (bytecode.jumpTarget === undefined) throw new Error(`${bytecode.opcode} has no jump target`);
  return bytecode.jumpTarget;
}

// JumpIfRoot(kFalseValue): skip a near jne over an unconditional jmp, so the bytecode target can be far.
export const JumpIfFalse: Template = ({ bytecode, labels }) => {
  const dontJump = labels.local("dont_jump");
  return [
    asm("cmp", [reg(RegisterRoles.accumulator), rootSlot("FalseValue")], "RootIndex::kFalseValue"),
    asm("jne", [labelRef(dontJump)]),
    asm("jmp", [labelRef(labels.at(jumpTarget(bytecode)))]),
    bind(dontJump),
  ];
};
