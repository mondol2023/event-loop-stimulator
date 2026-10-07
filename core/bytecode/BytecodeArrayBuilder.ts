import { BytecodeArray, type Instruction, instructionSize } from "./BytecodeArray";
import {
  type Opcode,
  type Operand,
  type OperandScale,
  bytecodeInfo,
  isJump,
  isWithoutExternalSideEffects,
  requiredScale,
} from "./bytecodes";
import { ConstantPool } from "./ConstantPool";
import { FeedbackVectorSpec } from "./FeedbackVectorSpec";
import { type PositionKind, SourcePositionTable } from "./SourcePositionTable";

// Assembles one function's bytecode (V8's BytecodeArrayBuilder + BytecodeArrayWriter). Instructions
// are collected first and laid out in `build()`, so a jump whose distance needs more than a byte is
// widened and everything after it moves. The generator never sees an offset while it emits.

/** Bytes V8 reserves per register slot in the frame. */
const REGISTER_SIZE = 8;

export class Label {
  /** Index of the instruction the label sits before; `undefined` until it is bound. */
  index: number | undefined;
}

export type BytecodeHeader = {
  /** The "Bytecode length" of a listing. */
  readonly length: number;
  /** Includes the receiver, so `function add(a, b)` has 3. */
  readonly parameterCount: number;
  readonly registerCount: number;
  readonly frameSize: number;
};

export type BuiltBytecode = {
  readonly array: BytecodeArray;
  readonly positions: SourcePositionTable;
  readonly header: BytecodeHeader;
};

type PendingPosition = { readonly position: number; readonly kind: PositionKind };

type Pending = {
  readonly opcode: Opcode;
  /** Operands as given; for a jump, the offset operand at index 0 is filled in by `build()`. */
  readonly operands: Operand[];
  scale: OperandScale;
  readonly label?: Label;
  /** `forward` jumps measure from the label to the instruction; `JumpLoop` the other way. */
  readonly direction?: "forward" | "backward";
  readonly position?: PendingPosition;
};

export class BytecodeArrayBuilder {
  readonly constantPool = new ConstantPool();
  readonly feedback = new FeedbackVectorSpec();

  private readonly parameterCount: number;
  private readonly pending: Pending[] = [];
  private top = 0;
  private highWater = 0;
  private latest: PendingPosition | undefined;

  constructor(options: { readonly parameterCount: number }) {
    this.parameterCount = options.parameterCount;
  }

  // Registers: temporaries are taken and given back in stack order.

  /** The number of registers in use; hand it to `releaseRegisters` to free everything taken after it. */
  get registerTop(): number {
    return this.top;
  }

  /** Takes the next free register and returns its index (0 for r0). */
  allocateRegister(): number {
    const index = this.top++;
    if (this.top > this.highWater) this.highWater = this.top;
    return index;
  }

  releaseRegisters(to: number): void {
    if (to > this.top) throw new Error(`cannot release to ${to}, above the ${this.top} registers in use`);
    this.top = to;
  }

  // Source positions: a position attaches to the next instruction emitted.

  setStatementPosition(position: number): void {
    this.latest = { position, kind: "statement" };
  }

  /** Ignored while a statement position is waiting: a statement position dominates. */
  setExpressionPosition(position: number): void {
    if (this.latest?.kind !== "statement") this.latest = { position, kind: "expression" };
  }

  // Instructions.

  emit(opcode: Opcode, ...operands: Operand[]): void {
    const scale = requiredScale(opcode, operands);
    this.pending.push({ opcode, operands, scale, ...this.takePosition(opcode) });
  }

  newLabel(): Label {
    return new Label();
  }

  /** Binds `label` to the next instruction to be emitted (or to the end if none follows). */
  bind(label: Label): void {
    if (label.index !== undefined) throw new Error("label already bound");
    label.index = this.pending.length;
  }

  /** A forward jump; `rest` are the operands after the offset (only `JumpIfForInDone` has any). */
  jump(opcode: Opcode, label: Label, ...rest: Operand[]): void {
    if (!isJump(opcode) || opcode === "JumpLoop" || bytecodeInfo(opcode).operands[0] !== "UImm") {
      throw new Error(`${opcode} is not a jump with an immediate offset`);
    }
    if (label.index !== undefined) throw new Error(`${opcode} cannot jump back to a bound label: use jumpLoop`);
    this.pushJump(opcode, label, "forward", rest);
  }

  /** The backward jump at the end of a loop body; `label` must already be bound to the loop header. */
  jumpLoop(label: Label, depth: number, feedbackSlot: number): void {
    if (label.index === undefined) throw new Error("JumpLoop needs a label that is already bound");
    this.pushJump("JumpLoop", label, "backward", [depth, feedbackSlot]);
  }

  private pushJump(opcode: Opcode, label: Label, direction: "forward" | "backward", rest: Operand[]): void {
    const operands = [0, ...rest];
    this.pending.push({
      opcode,
      operands,
      scale: requiredScale(opcode, operands),
      label,
      direction,
      ...this.takePosition(opcode),
    });
  }

  private takePosition(opcode: Opcode): { position?: PendingPosition } {
    const latest = this.latest;
    if (latest && (latest.kind === "statement" || !isWithoutExternalSideEffects(opcode))) {
      this.latest = undefined;
      return { position: latest };
    }
    return {};
  }

  /** Lays the instructions out and returns the finished function body. */
  build(): BuiltBytecode {
    const offsets = this.settle();

    const instructions: Instruction[] = this.pending.map((p, i) => {
      const offset = offsets[i] ?? 0;
      const base = { offset, opcode: p.opcode, scale: p.scale, operands: [...p.operands], size: instructionSize(p.opcode, p.scale) };
      return p.label ? { ...base, jumpTarget: targetOffset(p.label, offsets) } : base;
    });
    const array = new BytecodeArray(instructions);

    const positions = new SourcePositionTable();
    this.pending.forEach((p, i) => {
      if (p.position) positions.add(offsets[i] ?? 0, p.position.position, p.position.kind);
    });

    const registerCount = this.highWater;
    const header = { length: array.length, parameterCount: this.parameterCount, registerCount, frameSize: registerCount * REGISTER_SIZE };
    return { array, positions, header };
  }

  /**
   * Fixes the offset operand of every jump, widening jumps that do not fit, until the layout stops
   * changing. Scales only grow, so this ends. Returns the offset of each instruction plus the end.
   */
  private settle(): number[] {
    for (;;) {
      const offsets = layout(this.pending);
      let changed = false;
      this.pending.forEach((p, i) => {
        if (!p.label) return;
        const prefix = p.scale === 1 ? 0 : 1;
        const from = (offsets[i] ?? 0) + prefix;
        const target = targetOffset(p.label, offsets);
        p.operands[0] = p.direction === "backward" ? from - target : target - from;
        const needed = requiredScale(p.opcode, p.operands);
        if (needed > p.scale) {
          p.scale = needed;
          changed = true;
        }
      });
      if (!changed) return offsets;
    }
  }
}

/** Offset of each instruction, then the total length as the last element. */
function layout(pending: readonly Pending[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const p of pending) {
    offsets.push(offset);
    offset += instructionSize(p.opcode, p.scale);
  }
  offsets.push(offset);
  return offsets;
}

function targetOffset(label: Label, offsets: readonly number[]): number {
  if (label.index === undefined) throw new Error("unbound label");
  return offsets[label.index] ?? 0;
}
