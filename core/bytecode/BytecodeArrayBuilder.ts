import { BytecodeArray, type Instruction, instructionSize } from "./BytecodeArray";
import {
  type Opcode,
  type Operand,
  type OperandScale,
  type OperandType,
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
  /** The jumps written to this label, in order. */
  readonly jumps: Pending[] = [];
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

type Pending = { -readonly [K in keyof OptimizerNode]: OptimizerNode[K] } & {
  scale: OperandScale;
  /** Index in the pending list, kept for jumps. */
  at?: number;
  /** A forward jump's constant-pool reservation, until its label is bound and decides its form. */
  reservation?: OperandScale;
  /** The jump has been rewritten to its `...Constant` form: its operand is a pool index. */
  viaConstant?: boolean;
};

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
  private readonly fixedRegisters: number;
  private top: number;
  private latest: SourceInfo | undefined;
  // The writer's view of the basic block it is in.
  private exitSeen = false;
  private last: Pending | undefined;

  constructor(options: BuilderOptions) {
    this.parameterCount = options.parameterCount;
    const locals = options.localCount ?? 0;
    this.fixedRegisters = locals;
    this.top = locals;
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
    this.resolveForwardJumps(label);
  }

  /** Like V8's PatchJump: a distance that fits is inlined; a longer one goes to the pool and the jump becomes its `...Constant` form. */
  private resolveForwardJumps(label: Label): void {
    const open = label.jumps.filter((p) => p.reservation !== undefined);
    if (open.length === 0) return;
    const offsets = this.settle(this.pending.map((p) => shortStar(p)), true);
    const target = offsets[label.index as number] ?? 0;
    for (const jump of open) {
      const prefix = jump.scale === 1 ? 0 : 1;
      const distance = target - ((offsets[jump.at as number] ?? 0) + prefix);
      const rest = jump.operands.slice(1);
      if (requiredScale(jump.opcode, [distance, ...rest]) <= jump.scale) {
        this.constantPool.discard();
        jump.operands = [distance, ...rest];
      } else {
        const opcode = `${jump.opcode}Constant`;
        if (!(opcode in BYTECODES)) throw new Error(`${jump.opcode} has no constant-pool form`);
        const operands = [this.constantPool.commit(distance), ...rest];
        jump.opcode = opcode as Opcode;
        jump.operands = operands;
        jump.scale = Math.max(jump.scale, requiredScale(jump.opcode, operands)) as OperandScale;
        jump.viaConstant = true;
      }
      delete jump.reservation;
    }
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

  /**
   * The backward jump at the end of a loop body; `label` must already be bound to the loop header.
   * `position` is forced as an expression position (the implicit stack check), over a waiting statement one.
   */
  jumpLoop(label: Label, depth: number, feedbackSlot: number, position?: number): void {
    if (label.index === undefined) throw new Error("JumpLoop needs a label that is already bound");
    if (position !== undefined) this.latest = { position, kind: "expression" };
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
    const pending: Pending = { ...node, scale: requiredScale(node.opcode, node.operands), at: this.pending.length };
    if (node.jump) {
      const label = node.jump.label as Label;
      label.referenced = true;
      label.jumps.push(pending);
      // The distance is unknown until the label is bound, so reserve a pool entry (as V8 does).
      if (node.jump.direction === "forward") {
        pending.reservation = this.constantPool.reserve();
        pending.scale = Math.max(pending.scale, pending.reservation) as OperandScale;
      }
    }
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

    // The frame holds the locals and the highest temporary an instruction still names: V8 sizes it
    // from what the register optimizer let through, not from what the allocator handed out.
    const registerCount = Math.max(this.fixedRegisters, highestRegisterUsed(this.pending) + 1);
    const header = { length: array.length, parameterCount: this.parameterCount, registerCount, frameSize: registerCount * REGISTER_SIZE };
    return { array, positions, header };
  }

  /**
   * Fixes the offset operand of every jump, widening jumps that do not fit, until the layout stops
   * changing. Scales only grow, so this ends. Returns the offset of each instruction plus the end.
   */
  private settle(instructions: Pending[], partial = false): number[] {
    for (;;) {
      const offsets = layout(instructions);
      let changed = false;
      instructions.forEach((p, i) => {
        if (!p.jump) return;
        // A pool index is not a distance; an undecided forward jump has its size fixed already.
        if (p.viaConstant || (partial && p.reservation !== undefined)) return;
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

/** The highest local register any operand of `instructions` names, or -1. */
function highestRegisterUsed(instructions: readonly Pending[]): number {
  let highest = -1;
  const note = (operand: Operand | undefined, extra: number): void => {
    if (typeof operand !== "number" || operand > -7) return;
    // A list or pair names registers going down in operand value, up in index.
    highest = Math.max(highest, -7 - operand + extra);
  };
  for (const p of instructions) {
    if (isShortStar(p.opcode)) {
      highest = Math.max(highest, Number(p.opcode.slice(4)));
      continue;
    }
    const types = bytecodeInfo(p.opcode).operands;
    for (let i = 0; i < types.length; i++) {
      const type = types[i] as OperandType;
      if (type === "Reg" || type === "RegOut" || type === "RegInOut") note(p.operands[i], 0);
      else if (type === "RegList" || type === "RegOutList") {
        const count = Number(p.operands[i + 1]);
        if (count > 0) note(p.operands[i], count - 1);
        i++;
      } else if (type === "RegPair" || type === "RegOutPair") note(p.operands[i], 1);
      else if (type === "RegOutTriple") note(p.operands[i], 2);
    }
  }
  return highest;
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
