// Sparkplug's x64 frame and entry/exit code, after V8's src/execution/frame-constants.h (UnoptimizedFrameConstants),
// src/builtins/x64/builtins-x64.cc (Generate_BaselineOutOfLinePrologue) and src/baseline/x64/baseline-compiler-x64-inl.h.

import { local } from "../bytecode/bytecodes";
import { imm, mem, reg, type Operand } from "./x64/Encoder";
import { RegisterRoles } from "./x64/registers";
import { asm, callBuiltin, tailCallBuiltin, type Emit, type TemplateInput } from "./Template";

// rbp-relative slots in push order of Generate_BaselineOutOfLinePrologue (EnterFrame(BASELINE) pushes no type marker).
export const BaselineFrame = {
  callerPc: 8,
  callerFp: 0,
  context: -8,
  function: -16,
  argc: -24,
  bytecodeArray: -32,
  feedbackCell: -40,
  feedbackVector: -48,
  registerFile: -56, // kRegisterFileFromFp = -kFixedFrameSizeFromFp - kSystemPointerSize
} as const;

/** N in `rk = [rbp - 8*(k+N)]`: the six fixed slots below the saved rbp, plus one. */
export const REGISTER_FILE_SLOT = -BaselineFrame.registerFile / 8;

/** BaselineAssembler::RegisterFrameOperand: an interpreter register operand is already an rbp-relative word index. */
export function registerOperand(operand: number): Operand {
  return mem(RegisterRoles.framePointer, 8 * operand);
}

/** Local register rk, `[rbp - 8*(k+N)]`. */
export function bytecodeRegister(k: number): Operand {
  return registerOperand(local(k));
}

export type PrologueInput = {
  readonly registerCount: number;
  /** Bytes; stands in for V8's max_frame_size. */
  readonly frameSize: number;
  /** Illustrative tagged pointer the compiler embeds for the BytecodeArray handle. */
  readonly bytecodeArray: bigint;
  /** Register index of bytecode_->incoming_new_target_or_generator_register(), if any. */
  readonly newTargetOrGenerator?: number;
};

/** BaselineCompiler::Prologue: arguments into BaselineOutOfLinePrologueDescriptor's registers, the call, then PrologueFillFrame. */
export function prologue(input: PrologueInput): Emit[] {
  const out: Emit[] = [
    // rsi, rdi, rax and rdx already hold context, closure, argc and new.target, so only these two move.
    asm("mov", [reg("rbx"), imm(input.frameSize)], "max_frame_size (kJavaScriptCallExtraArg1Register)"),
    asm("mov", [reg(RegisterRoles.bytecodeArray), imm(input.bytecodeArray)], "BytecodeArray"),
    callBuiltin("BaselineOutOfLinePrologue"),
  ];
  // The builtin returns with rax = undefined; each push fills one register slot. V8 loops at 16+ registers, we unroll.
  for (let k = 0; k < input.registerCount; k++) {
    out.push(
      k === input.newTargetOrGenerator
        ? asm("push", [reg(RegisterRoles.newTarget)], `r${k} = new.target or generator`)
        : asm("push", [reg(RegisterRoles.accumulator)], `r${k} = undefined`),
    );
  }
  return out;
}

/** BaselineCompiler::VisitReturn: tail call BaselineLeaveFrame, which updates the budget, leaves the frame and drops the arguments. */
export function epilogue({ bytecode, fn }: Pick<TemplateInput, "bytecode" | "fn">): Emit[] {
  const sizeWithoutPrefix = bytecode.size - (bytecode.scale === 1 ? 0 : 1);
  const profilingWeight = bytecode.offset + sizeWithoutPrefix;
  return [
    asm("mov", [reg("rbx"), imm(fn.parameterCount)], "params size (BaselineLeaveFrameDescriptor)"),
    asm("mov", [reg("rcx"), imm(-profilingWeight)], "budget weight (BaselineLeaveFrameDescriptor)"),
    tailCallBuiltin("BaselineLeaveFrame"),
  ];
}
