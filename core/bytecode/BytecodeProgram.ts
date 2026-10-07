import type { FunctionId } from "@/core/shared/ids";
import type { BytecodeArray } from "./BytecodeArray";
import type { BytecodeArrayBuilder } from "./BytecodeArrayBuilder";
import type { ConstantPool } from "./ConstantPool";
import type { FeedbackVectorSpec } from "./FeedbackVectorSpec";
import type { PrintableFunction } from "./printer";
import type { SourcePositionTable } from "./SourcePositionTable";

// The compiled form of a program: one BytecodeFunction per function in the source, the CommonJS
// wrapper first. Closures refer to their inner functions through `sfi` constant-pool entries.

/** One row of V8's handler table: the try range, where control goes, and how it was caught. */
export type HandlerEntry = {
  /** First bytecode offset covered by the handler, inclusive. */
  readonly start: number;
  /** Bytecode offset the covered range ends at, exclusive. */
  readonly end: number;
  readonly handler: number;
  /** V8's catch prediction, as the listing prints it. */
  readonly prediction: number;
  /** V8's handler data, as the listing prints it. */
  readonly data: number;
};

/** A handler row in the normalized form of the recorded listings: `(3, 14) -> 14 (prediction=1, data=0)`. */
export function formatHandlerEntry(entry: HandlerEntry): string {
  return `(${entry.start}, ${entry.end}) -> ${entry.handler} (prediction=${entry.prediction}, data=${entry.data})`;
}

export type BytecodeFunction = {
  /** Index in `BytecodeProgram.functions`; 0 is the CommonJS wrapper. */
  readonly id: FunctionId;
  /** The function's own name, `""` for an anonymous function (and for the wrapper). */
  readonly name: string;
  /** Includes the receiver. */
  readonly parameterCount: number;
  readonly registerCount: number;
  readonly frameSize: number;
  readonly array: BytecodeArray;
  readonly constantPool: ConstantPool;
  readonly positions: SourcePositionTable;
  readonly feedback: FeedbackVectorSpec;
  readonly handlerTable: readonly HandlerEntry[];
  /** The functions its `sfi` constant-pool entries point to, in pool order. */
  readonly children: readonly FunctionId[];
};

export type BytecodeProgram = { readonly functions: readonly BytecodeFunction[] };

/** The printer's view of a function. */
export function toPrintable(fn: BytecodeFunction): PrintableFunction {
  return {
    name: fn.name,
    array: fn.array,
    header: {
      length: fn.array.length,
      parameterCount: fn.parameterCount,
      registerCount: fn.registerCount,
      frameSize: fn.frameSize,
    },
    positions: fn.positions,
    constantPool: fn.constantPool,
    handlerTable: fn.handlerTable.map(formatHandlerEntry),
  };
}

/** Seals a builder into the function it assembled. */
export function finishFunction(
  builder: BytecodeArrayBuilder,
  meta: { readonly id: FunctionId; readonly name: string; readonly children?: readonly FunctionId[]; readonly handlerTable?: readonly HandlerEntry[] },
): BytecodeFunction {
  const { array, positions, header } = builder.build();
  return {
    id: meta.id,
    name: meta.name,
    parameterCount: header.parameterCount,
    registerCount: header.registerCount,
    frameSize: header.frameSize,
    array,
    constantPool: builder.constantPool,
    positions,
    feedback: builder.feedback,
    handlerTable: meta.handlerTable ?? [],
    children: meta.children ?? [],
  };
}
