import type { BytecodeHeader } from "@/core/bytecode/BytecodeArrayBuilder";
import { toPrintable } from "@/core/bytecode/BytecodeProgram";
import { printBytecodeArray } from "@/core/bytecode/printer";
import type { FunctionId } from "@/core/shared/ids";
import type { BytecodePos, CodeViewStrategy, EmittedLine } from "./types";

// The Bytecode view: the instructions of every function as `--print-bytecode` shows them, minus the
// addresses and raw bytes. A line is one instruction and stands for exactly that instruction.

export type BytecodeLine = EmittedLine & {
  readonly offset: number;
  /** The `S>` / `E>` mark V8 prints on this instruction, if it has one. */
  readonly sourcePosition?: { readonly at: number; readonly kind: "S" | "E" };
};

export type BytecodeFunctionView = {
  readonly functionId: FunctionId;
  readonly name: string;
  readonly header: BytecodeHeader;
  readonly lines: readonly BytecodeLine[];
  readonly constantPool: readonly string[];
  readonly handlerTable: readonly string[];
};

export type BytecodeViewOutput = { readonly functions: readonly BytecodeFunctionView[] };

export const bytecodeView: CodeViewStrategy<BytecodeViewOutput> = {
  id: "bytecode",
  emit(program) {
    return {
      functions: program.functions.map((fn) => {
        const printed = printBytecodeArray(toPrintable(fn));
        const lines = printed.instructions.map((instruction): BytecodeLine => {
          const positions: readonly BytecodePos[] = [{ functionId: fn.id, bytecodeOffset: instruction.offset }];
          return {
            text: instruction.text,
            positions,
            offset: instruction.offset,
            ...(instruction.position ? { sourcePosition: instruction.position } : {}),
          };
        });
        return {
          functionId: fn.id,
          name: fn.name,
          header: printed.header,
          lines,
          constantPool: printed.constantPool,
          handlerTable: printed.handlerTable,
        };
      }),
    };
  },
};
