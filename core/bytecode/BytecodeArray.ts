import { type Opcode, type Operand, type OperandScale, operandSizes } from "./bytecodes";

// An assembled function body: the instructions with their byte offsets. The bytes themselves are
// not materialised; the offsets, sizes and operand values carry everything the listings need.

export type Instruction = {
  /** Byte offset of the instruction, counting from its `Wide`/`ExtraWide` prefix if it has one. */
  readonly offset: number;
  readonly opcode: Opcode;
  readonly scale: OperandScale;
  readonly operands: readonly Operand[];
  /** Total bytes, prefix included. */
  readonly size: number;
  /** Absolute offset a jump lands on. Only jumps have one. */
  readonly jumpTarget?: number;
};

/** Bytes an instruction takes: the optional prefix, the opcode and each operand. */
export function instructionSize(opcode: Opcode, scale: OperandScale): number {
  const prefix = scale === 1 ? 0 : 1;
  return prefix + 1 + operandSizes(opcode, scale).reduce((total, size) => total + size, 0);
}

export class BytecodeArray {
  readonly instructions: readonly Instruction[];

  constructor(instructions: readonly Instruction[]) {
    this.instructions = instructions;
  }

  /** The "Bytecode length" of a listing. */
  get length(): number {
    const last = this.instructions.at(-1);
    return last ? last.offset + last.size : 0;
  }

  /** The instruction that starts at `offset`, if any. */
  instructionAt(offset: number): Instruction | undefined {
    let low = 0;
    let high = this.instructions.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const found = this.instructions[mid];
      if (!found) return undefined;
      if (found.offset === offset) return found;
      if (found.offset < offset) low = mid + 1;
      else high = mid - 1;
    }
    return undefined;
  }
}
