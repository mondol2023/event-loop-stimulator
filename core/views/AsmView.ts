import { compileBaseline } from "@/core/baseline/BaselineCompiler";
import { FUNCTION_ENTRY_BYTECODE_OFFSET } from "@/core/baseline/Template";
import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import type { FunctionId } from "@/core/shared/ids";
import type { BytecodePos, CodeViewStrategy, EmittedLine } from "./types";

// The Asm view: each function's Sparkplug-style baseline code in AT&T syntax. Illustrative: a model of
// V8's output that is never run. A line is one machine instruction.

export type AsmLine = EmittedLine & {
  /** Byte offset of the instruction within the function's code. */
  readonly address: number;
};

export type AsmFunctionView = {
  readonly functionId: FunctionId;
  readonly name: string;
  readonly lines: readonly AsmLine[];
  /** Why there are no lines, if the baseline compiler failed for this function. */
  readonly unavailable?: string;
};

export type AsmViewOutput = { readonly functions: readonly AsmFunctionView[] };

export const asmView: CodeViewStrategy<AsmViewOutput> = {
  id: "asm",
  emit(program: BytecodeProgram) {
    return {
      functions: program.functions.map((fn): AsmFunctionView => {
        const compiled = compileBaseline(fn);
        if (!compiled.ok) {
          return { functionId: fn.id, name: fn.name, lines: [], unavailable: compiled.error.map((e) => `${e.code}: ${e.message}`).join("; ") };
        }
        let address = 0;
        const lines = compiled.value.instructions.map((instruction): AsmLine => {
          // Prologue code belongs to no bytecode.
          const positions: readonly BytecodePos[] =
            instruction.bytecodeOffset === FUNCTION_ENTRY_BYTECODE_OFFSET ? [] : [{ functionId: fn.id, bytecodeOffset: instruction.bytecodeOffset }];
          const line: AsmLine = {
            text: instruction.comment === undefined ? instruction.asm : `${instruction.asm} ; ${instruction.comment}`,
            address,
            positions,
          };
          address += instruction.bytes.length;
          return line;
        });
        return { functionId: fn.id, name: fn.name, lines };
      }),
    };
  },
};
