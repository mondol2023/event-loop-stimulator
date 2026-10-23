import { compileBaseline } from "@/core/baseline/BaselineCompiler";
import { FUNCTION_ENTRY_BYTECODE_OFFSET } from "@/core/baseline/Template";
import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import type { FunctionId } from "@/core/shared/ids";
import type { BytecodePos, CodeViewStrategy, EmittedLine } from "./types";

// The Binary view: the bytes of each asm line, one line per instruction so the two views stay aligned.

export type BinaryLine = EmittedLine & {
  readonly address: number;
  readonly bytes: readonly number[];
};

export type BinaryFunctionView = {
  readonly functionId: FunctionId;
  readonly name: string;
  readonly lines: readonly BinaryLine[];
  /** Why there are no lines, if the baseline compiler failed for this function. */
  readonly unavailable?: string;
};

export type BinaryViewOutput = { readonly functions: readonly BinaryFunctionView[] };

const hex = (byte: number): string => byte.toString(16).padStart(2, "0");

export const binaryView: CodeViewStrategy<BinaryViewOutput> = {
  id: "binary",
  emit(program: BytecodeProgram) {
    return {
      functions: program.functions.map((fn): BinaryFunctionView => {
        const compiled = compileBaseline(fn);
        if (!compiled.ok) {
          return { functionId: fn.id, name: fn.name, lines: [], unavailable: compiled.error.map((e) => `${e.code}: ${e.message}`).join("; ") };
        }
        let address = 0;
        const lines = compiled.value.instructions.map((instruction): BinaryLine => {
          const positions: readonly BytecodePos[] =
            instruction.bytecodeOffset === FUNCTION_ENTRY_BYTECODE_OFFSET ? [] : [{ functionId: fn.id, bytecodeOffset: instruction.bytecodeOffset }];
          const line: BinaryLine = { text: instruction.bytes.map(hex).join(" "), address, bytes: instruction.bytes, positions };
          address += instruction.bytes.length;
          return line;
        });
        return { functionId: fn.id, name: fn.name, lines };
      }),
    };
  },
};
