import type { BytecodeArray, Instruction } from "./BytecodeArray";
import type { BytecodeHeader } from "./BytecodeArrayBuilder";
import { type Operand, type OperandType, bytecodeInfo, formatRegister } from "./bytecodes";
import type { ConstantPool } from "./ConstantPool";
import type { SourcePositionTable } from "./SourcePositionTable";

// Prints bytecode the way `node --print-bytecode` does, minus the addresses and the raw bytes.
// `printBytecodeArray` returns the same shape the recorder writes into `*.expected.json`
// (RealFunctionBytecode in scripts/conformance/expectation.mts), so the two compare directly.

export type PrintableFunction = {
  readonly name: string;
  readonly array: BytecodeArray;
  readonly header: BytecodeHeader;
  readonly positions: SourcePositionTable;
  readonly constantPool: ConstantPool;
  /** One normalized row per handler, e.g. `(3, 14) -> 14 (prediction=1, data=0)`. */
  readonly handlerTable: readonly string[];
};

export type PrintedInstruction = {
  readonly offset: number;
  readonly position?: { readonly at: number; readonly kind: "S" | "E" };
  readonly text: string;
};

export type PrintedFunction = {
  readonly name: string;
  readonly header: BytecodeHeader;
  readonly instructions: readonly PrintedInstruction[];
  readonly constantPool: readonly string[];
  readonly handlerTable: readonly string[];
  /** Keyed by the constant-pool index of the child's shared function info. */
  readonly children: Readonly<Record<string, PrintedFunction>>;
};

const HANDLER_ENTRY_BYTES = 16;

function single(type: OperandType, value: Operand): string {
  switch (type) {
    case "Reg":
    case "RegOut":
    case "RegInOut":
      return formatRegister(Number(value));
    case "Flag8":
    case "Flag16":
      return `#${value}`;
    default:
      return `[${value}]`;
  }
}

/** `rA-rB` for the `count` consecutive registers that start at `first`. */
function registerRange(first: number, count: number): string {
  return `${formatRegister(first)}-${formatRegister(first - (count - 1))}`;
}

/** One instruction as `--print-bytecode` writes it, with a jump's absolute target as `(@N)`. */
export function formatInstruction(instruction: Instruction): string {
  const { opcode, operands, scale } = instruction;
  const types = bytecodeInfo(opcode).operands;
  const parts: string[] = [];
  for (let i = 0; i < types.length; i++) {
    const type = types[i] as OperandType;
    const value = operands[i] as Operand;
    if (type === "RegList" || type === "RegOutList") {
      parts.push(registerRange(Number(value), Number(operands[i + 1])));
      i++; // the RegCount that follows a list is part of it
    } else if (type === "RegPair" || type === "RegOutPair") {
      parts.push(registerRange(Number(value), 2));
    } else if (type === "RegOutTriple") {
      parts.push(registerRange(Number(value), 3));
    } else {
      parts.push(single(type, value));
    }
  }
  const mnemonic = scale === 1 ? opcode : `${opcode}.${scale === 2 ? "Wide" : "ExtraWide"}`;
  const text = parts.length === 0 ? mnemonic : `${mnemonic} ${parts.join(", ")}`;
  return instruction.jumpTarget === undefined ? text : `${text} (@${instruction.jumpTarget})`;
}

export function printBytecodeArray(fn: PrintableFunction): PrintedFunction {
  return {
    name: fn.name,
    header: fn.header,
    instructions: fn.array.instructions.map((instruction) => {
      const entry = fn.positions.at(instruction.offset);
      const text = formatInstruction(instruction);
      return entry
        ? { offset: instruction.offset, position: { at: entry.position, kind: entry.kind === "statement" ? ("S" as const) : ("E" as const) }, text }
        : { offset: instruction.offset, text };
    }),
    constantPool: fn.constantPool.printEntries(),
    handlerTable: fn.handlerTable,
    children: {},
  };
}

/** A listing in `--print-bytecode` style without addresses or raw bytes, one string per line. */
export function formatListing(fn: PrintableFunction): string[] {
  const printed = printBytecodeArray(fn);
  const lines = [
    `[bytecode for function: ${fn.name}]`,
    `Bytecode length: ${fn.header.length}`,
    `Parameter count ${fn.header.parameterCount}`,
    `Register count ${fn.header.registerCount}`,
    `Frame size ${fn.header.frameSize}`,
  ];
  for (const instruction of printed.instructions) {
    const mark = instruction.position ? `${String(instruction.position.at).padStart(5)} ${instruction.position.kind}>` : " ".repeat(8);
    lines.push(`${mark} @ ${String(instruction.offset).padStart(4)} : ${instruction.text}`);
  }
  lines.push(`Constant pool (size = ${printed.constantPool.length})`);
  printed.constantPool.forEach((entry, i) => lines.push(`${String(i).padStart(12)}: ${entry}`));
  lines.push(`Handler Table (size = ${printed.handlerTable.length * HANDLER_ENTRY_BYTES})`);
  if (printed.handlerTable.length > 0) lines.push("   from   to       hdlr (prediction,   data)", ...printed.handlerTable);
  return lines;
}
