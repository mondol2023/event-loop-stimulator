import { BytecodeArray, type Instruction, instructionSize } from "./BytecodeArray";
import {
  type Opcode,
  type Operand,
  type OperandScale,
  BYTECODES,
  bytecodeInfo,
  isJump,
  isShortStar,
  isWithoutExternalSideEffects,
  local,
  requiredScale,
} from "./bytecodes";
import { ConstantPool } from "./ConstantPool";
import { FeedbackVectorSpec } from "./FeedbackVectorSpec";
import { type OptimizerNode, RegisterOptimizer, type SourceInfo } from "./RegisterOptimizer";
import { SourcePositionTable } from "./SourcePositionTable";

// Assembles one function's bytecode: V8's BytecodeArrayBuilder, the register optimizer it feeds and
// the BytecodeArrayWriter at the end of that pipeline. Instructions are collected first and laid
// out in `build()`, so a jump whose distance needs more than a byte is widened and everything
// after it moves. The generator never sees an offset while it emits.
//
//   emit -> [register optimizer] -> writer (dead code, load elision) -> instruction list -> build()

/** Bytes V8 reserves per register slot in the frame. */
const REGISTER_SIZE = 8;

export class Label {
  /** Index of the instruction the label sits before; `undefined` until it is bound. */
  index: number | undefined;
  /** True once a jump that was actually written targets it. A label nothing jumps to is never bound. */
  referenced = false;
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

export type BuilderOptions = {
  /** Includes the receiver. */
  readonly parameterCount: number;
  /** Registers the generator assigned to the function's own variables; temporaries start after them. */
  readonly localCount?: number;
  /** Run the register optimizer (what V8 does for every function it compiles). */
  readonly optimizeRegisters?: boolean;
};

type Pending = OptimizerNode & { scale: OperandScale };

/** Accumulator loads that have no effect, so that the next load can make them unnecessary. */
const ACCUMULATOR_LOADS_WITHOUT_EFFECTS: ReadonlySet<Opcode> = new Set<Opcode>([
  "Ldar",
  "LdaZero",
  "LdaSmi",
  "LdaUndefined",
  "LdaNull",
  "LdaTheHole",
  "LdaTrue",
  "LdaFalse",
  "LdaConstant",
  "LdaContextSlot",
  "LdaCurrentContextSlot",
  "LdaImmutableContextSlot",
  "LdaImmutableCurrentContextSlot",
]);

/** Instructions after which the rest of a basic block can never run. */
const LEAVES_BLOCK: ReadonlySet<Opcode> = new Set<Opcode>(["Return", "Throw", "ReThrow", "Abort", "Jump", "JumpConstant"]);

export class BytecodeArrayBuilder {
  readonly constantPool = new ConstantPool();
  readonly feedback = new FeedbackVectorSpec();

  private readonly parameterCount: number;
  private readonly pending: Pending[] = [];
  private readonly optimizer: RegisterOptimizer | undefined;
  private top: number;
  private highWater: number;
  private latest: SourceInfo | undefined;
  // The writer's view of the basic block it is in.
  private exitSeen = false;
  private last: Pending | undefined;

  constructor(options: BuilderOptions) {
    this.parameterCount = options.parameterCount;
    const locals = options.localCount ?? 0;
    this.top = locals;
    this.highWater = locals;
    if (options.optimizeRegisters) {
      this.optimizer = new RegisterOptimizer({ fixedRegisters: locals, parameterCount: options.parameterCount }, (node) => this.write(node));
    }
  }

  // Registers: temporaries are taken and given back in stack order.

  /** The number of registers in use; hand it to `releaseRegisters` to free everything taken after it. */
  get registerTop(): number {
    return this.top;
  }

  /** Takes the next free register and returns its index (0 for r0). */
  allocateRegister(): number {
    return this.allocateRegisterList(1);
  }

  /** Takes `count` consecutive registers and returns the index of the first. */
  allocateRegisterList(count: number): number {
    const first = this.top;
    this.top += count;
    if (this.top > this.highWater) this.highWater = this.top;
    for (let i = 0; i < count; i++) this.optimizer?.registerAllocated(local(first + i));
    return first;
  }

  releaseRegisters(to: number): void {
    if (to > this.top) throw new Error(`cannot release to ${to}, above the ${this.top} registers in use`);
    const freed: number[] = [];
    for (let i = to; i < this.top; i++) freed.push(local(i));
    this.optimizer?.registersFreed(freed);
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
    const optimizer = this.optimizer;
    if (optimizer) {
      if (isShortStar(opcode)) return optimizer.doStar(local(Number(opcode.slice(4))), this.takePosition(opcode));
      if (opcode === "Ldar") return optimizer.doLdar(Number(operands[0]), this.takePosition(opcode));
      if (opcode === "Star") return optimizer.doStar(Number(operands[0]), this.takePosition(opcode));
      if (opcode === "Mov") return optimizer.doMov(Number(operands[0]), Number(operands[1]), this.takePosition(opcode));
      const prepared = optimizer.prepare(opcode, operands);
      return optimizer.emit({ opcode, operands: prepared, info: this.takePosition(opcode) });
    }
    this.write({ opcode, operands, info: this.takePosition(opcode) });
  }

  newLabel(): Label {
    return new Label();
  }

  /**
   * Binds `label` to the next instruction to be emitted. A label no written jump refers to is left
   * alone, as in V8: it starts no basic block, so dead code stays dead.
   */
  bind(label: Label): void {
    if (label.index !== undefined) throw new Error("label already bound");
    if (!label.referenced) return;
    this.optimizer?.flush();
    label.index = this.pending.length;
    this.startBasicBlock();
  }

  /** Binds the head of a loop; the `JumpLoop` that closes the loop refers back to it. */
  bindLoopHeader(label: Label): void {
    if (label.index !== undefined) throw new Error("label already bound");
    this.optimizer?.flush();
    label.index = this.pending.length;
    this.startBasicBlock();
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

  /** True after an instruction that leaves the block, until a label that something jumps to is bound. */
  get remainderOfBlockIsDead(): boolean {
    return this.exitSeen;
  }

  private pushJump(opcode: Opcode, label: Label, direction: "forward" | "backward", rest: Operand[]): void {
    const operands: Operand[] = [0, ...rest];
    requiredScale(opcode, operands);
    const jump = { label, direction };
    if (this.optimizer) {
      const prepared = this.optimizer.prepare(opcode, operands);
      this.optimizer.emit({ opcode, operands: prepared, info: this.takePosition(opcode), jump });
    } else {
      this.write({ opcode, operands, info: this.takePosition(opcode), jump });
    }
  }

  private takePosition(opcode: Opcode): SourceInfo | undefined {
    const latest = this.latest;
    if (latest && (latest.kind === "statement" || !isWithoutExternalSideEffects(opcode))) {
      this.latest = undefined;
      return latest;
    }
    return undefined;
  }

  // The writer.

  private startBasicBlock(): void {
    this.last = undefined;
    this.exitSeen = false;
  }

  private write(node: OptimizerNode): void {
    if (this.exitSeen) return;
    if (LEAVES_BLOCK.has(node.opcode)) this.exitSeen = true;
    this.elideLastLoad(node);
    const pending: Pending = { ...node, scale: requiredScale(node.opcode, node.operands) };
    if (node.jump) (node.jump.label as Label).referenced = true;
    this.pending.push(pending);
    this.last = pending;
  }

  /**
   * If the previous instruction loaded the accumulator without any effect and this one writes
   * it afresh, the load was pointless. The position it carried moves to this instruction unless
   * this one has its own.
   */
  private elideLastLoad(next: OptimizerNode): void {
    const last = this.last;
    if (!last || this.pending.at(-1) !== last) return;
    if (!ACCUMULATOR_LOADS_WITHOUT_EFFECTS.has(last.opcode)) return;
    if (BYTECODES[next.opcode].accumulator !== "write") return;
    if (last.info && next.info) return;
    this.pending.pop();
    next.info ??= last.info;
  }

  /** Lays the instructions out and returns the finished function body. */
  build(): BuiltBytecode {
    const instructions = this.pending.map((p) => shortStar(p));
    const offsets = this.settle(instructions);

    const array = new BytecodeArray(
      instructions.map((p, i) => {
        const offset = offsets[i] ?? 0;
        const base = { offset, opcode: p.opcode, scale: p.scale, operands: [...p.operands], size: instructionSize(p.opcode, p.scale) };
        return p.jump ? { ...base, jumpTarget: targetOffset(p.jump.label as Label, offsets) } : base;
      }) satisfies Instruction[],
    );

    const positions = new SourcePositionTable();
    instructions.forEach((p, i) => {
      if (p.info) positions.add(offsets[i] ?? 0, p.info.position, p.info.kind);
    });

    const registerCount = this.highWater;
    const header = { length: array.length, parameterCount: this.parameterCount, registerCount, frameSize: registerCount * REGISTER_SIZE };
    return { array, positions, header };
  }

  /**
   * Fixes the offset operand of every jump, widening jumps that do not fit, until the layout stops
   * changing. Scales only grow, so this ends. Returns the offset of each instruction plus the end.
   */
  private settle(instructions: Pending[]): number[] {
    for (;;) {
      const offsets = layout(instructions);
      let changed = false;
      instructions.forEach((p, i) => {
        if (!p.jump) return;
        const prefix = p.scale === 1 ? 0 : 1;
        const from = (offsets[i] ?? 0) + prefix;
        const target = targetOffset(p.jump.label as Label, offsets);
        p.operands[0] = p.jump.direction === "backward" ? from - target : target - from;
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

/** `Star r3` is written as the one-byte `Star3`. */
function shortStar(p: Pending): Pending {
  if (p.opcode !== "Star") return p;
  const index = -7 - Number(p.operands[0]);
  if (index < 0 || index > 15) return p;
  return { ...p, opcode: `Star${index}` as Opcode, operands: [], scale: 1 };
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
