import { type Opcode, type Operand, type OperandType, bytecodeInfo, isJump } from "./bytecodes";

// V8's BytecodeRegisterOptimizer (src/interpreter/bytecode-register-optimizer.cc). The generator
// moves values around with `Ldar`, `Star` and `Mov` freely; this stage keeps track of which
// registers hold the same value ("equivalence sets") and emits a transfer only when something can
// observe the difference. Temporaries are not observable, which is why `a * b` prints as
// `Ldar r1; Mul r0` and not as a store into a temporary, a load and a multiply.
//
// Registers are operand values here (`local(i)`, `argument(i)`, `THIS`, ...), plus a virtual
// accumulator register. The stage writes the instructions it lets through to `sink`.

/** The accumulator as a register; never a real operand. */
export const ACCUMULATOR = 1 << 30;

export type SourceInfo = { readonly position: number; readonly kind: "statement" | "expression" };

/** An instruction on its way to the writer. */
export type OptimizerNode = {
  readonly opcode: Opcode;
  readonly operands: Operand[];
  info: SourceInfo | undefined;
  /** Set on a jump by the builder; the optimizer passes it through untouched. */
  readonly jump?: { readonly label: object; readonly direction: "forward" | "backward" };
};

/**
 * What an instruction ends up with when a position that was set aside meets one of its own: it is
 * a statement position if either is, and sits where the instruction's own position is if it has one.
 */
export function mergeSourceInfo(deferred: SourceInfo | undefined, own: SourceInfo | undefined): SourceInfo | undefined {
  if (!deferred) return own;
  if (!own) return deferred;
  return { position: own.position, kind: deferred.kind === "statement" || own.kind === "statement" ? "statement" : "expression" };
}

const FIRST_LOCAL = -7;
const localIndex = (operand: number): number => FIRST_LOCAL - operand;

class RegisterInfo {
  next: RegisterInfo = this;
  prev: RegisterInfo = this;

  constructor(
    readonly register: number,
    public equivalenceId: number,
    public materialized: boolean,
    public allocated: boolean,
  ) {}

  /** Joins the equivalence set of `info`, right after it. The register no longer holds the value itself. */
  addToEquivalenceSetOf(info: RegisterInfo): void {
    this.next.prev = this.prev;
    this.prev.next = this.next;
    this.next = info.next;
    this.prev = info;
    this.prev.next = this;
    this.next.prev = this;
    this.equivalenceId = info.equivalenceId;
    this.materialized = false;
  }

  moveToNewEquivalenceSet(equivalenceId: number, materialized: boolean): void {
    this.next.prev = this.prev;
    this.prev.next = this.next;
    this.next = this;
    this.prev = this;
    this.equivalenceId = equivalenceId;
    this.materialized = materialized;
  }

  isInSameEquivalenceSet(info: RegisterInfo): boolean {
    return this.equivalenceId === info.equivalenceId;
  }

  /** This register if it is materialized, else the first member of its set that is. */
  getMaterializedEquivalent(): RegisterInfo | undefined {
    if (this.materialized) return this;
    for (let visitor = this.next; visitor !== this; visitor = visitor.next) if (visitor.materialized) return visitor;
    return undefined;
  }

  getMaterializedEquivalentOtherThan(register: number): RegisterInfo | undefined {
    if (this.materialized && this.register !== register) return this;
    for (let visitor = this.next; visitor !== this; visitor = visitor.next) {
      if (visitor.materialized && visitor.register !== register) return visitor;
    }
    return undefined;
  }

  /**
   * The member to store this (materialized) register's value into before it changes: the allocated
   * one with the lowest register, so that temporaries drop out of the instruction stream.
   */
  getEquivalentToMaterialize(): RegisterInfo | undefined {
    let best: RegisterInfo | undefined;
    for (let visitor = this.next; visitor !== this; visitor = visitor.next) {
      // Another register already holds the value: nothing needs to be stored.
      if (visitor.materialized) return undefined;
      if (visitor.allocated && (best === undefined || order(visitor.register) < order(best.register))) best = visitor;
    }
    return best;
  }

  markTemporariesAsUnmaterialized(isTemporary: (register: number) => boolean): void {
    for (let visitor = this.next; visitor !== this; visitor = visitor.next) {
      if (visitor.register === ACCUMULATOR || isTemporary(visitor.register)) visitor.materialized = false;
    }
  }
}

/** V8's register index: locals count up from 0, parameters and the frame header are below, the accumulator in between. */
function order(register: number): number {
  return register === ACCUMULATOR ? -4 : -register - 7;
}

export class RegisterOptimizer {
  private readonly table = new Map<number, RegisterInfo>();
  private nextEquivalenceId = 0;
  private readonly accumulator: RegisterInfo;
  /** A statement position taken by a load or store that was elided; it goes to the next instruction written. */
  private deferred: SourceInfo | undefined;

  constructor(
    private readonly options: { readonly fixedRegisters: number; readonly parameterCount: number },
    private readonly sink: (node: OptimizerNode) => void,
  ) {
    this.accumulator = this.info(ACCUMULATOR);
    this.accumulator.allocated = true;
  }

  // The register file.

  private isTemporary = (register: number): boolean => register <= FIRST_LOCAL && localIndex(register) >= this.options.fixedRegisters;

  private isObservable(register: number): boolean {
    return register !== ACCUMULATOR && !this.isTemporary(register);
  }

  private info(register: number): RegisterInfo {
    let found = this.table.get(register);
    if (!found) {
      // Locals, parameters and the frame header start out holding their own value; a temporary
      // starts out unallocated until the allocator hands it out.
      found = new RegisterInfo(register, this.nextEquivalenceId++, true, !this.isTemporary(register));
      this.table.set(register, found);
    }
    return found;
  }

  private all(): RegisterInfo[] {
    return [...this.table.values()].sort((a, b) => order(a.register) - order(b.register));
  }

  registerAllocated(register: number): void {
    this.info(register).allocated = true;
  }

  registersFreed(registers: readonly number[]): void {
    for (const register of registers) this.info(register).allocated = false;
  }

  // Transfers.

  doLdar(source: number, info: SourceInfo | undefined): void {
    this.defer(info);
    this.registerTransfer(this.info(source), this.accumulator);
  }

  doStar(target: number, info: SourceInfo | undefined): void {
    this.defer(info);
    this.registerTransfer(this.accumulator, this.info(target));
  }

  doMov(source: number, target: number, info: SourceInfo | undefined): void {
    this.defer(info);
    this.registerTransfer(this.info(source), this.info(target));
  }

  private defer(info: SourceInfo | undefined): void {
    if (info) this.deferred = info;
  }

  private registerTransfer(input: RegisterInfo, output: RegisterInfo): void {
    const outputObservable = this.isObservable(output.register);
    const sameSet = output.isInSameEquivalenceSet(input);
    if (sameSet && (!outputObservable || output.materialized)) return;

    // Materialize an alternate in the equivalence set that `output` is leaving.
    if (output.materialized) this.createMaterializedEquivalent(output);
    if (!sameSet) output.addToEquivalenceSetOf(input);

    if (outputObservable) {
      // Force the store to be emitted when the register is observable.
      output.materialized = false;
      const from = input.getMaterializedEquivalent();
      if (!from) throw new Error("an equivalence set always has a materialized member");
      this.outputRegisterTransfer(from, output);
    }
    if (this.isObservable(input.register)) input.markTemporariesAsUnmaterialized(this.isTemporary);
  }

  private outputRegisterTransfer(input: RegisterInfo, output: RegisterInfo): void {
    if (input.register === ACCUMULATOR) this.write("Star", [output.register]);
    else if (output.register === ACCUMULATOR) this.write("Ldar", [input.register]);
    else this.write("Mov", [input.register, output.register]);
    output.materialized = true;
  }

  private write(opcode: Opcode, operands: Operand[]): void {
    const node: OptimizerNode = { opcode, operands, info: this.deferred };
    this.deferred = undefined;
    this.sink(node);
  }

  private materialize(info: RegisterInfo): void {
    if (info.materialized) return;
    const from = info.getMaterializedEquivalent();
    if (!from) throw new Error("an equivalence set always has a materialized member");
    this.outputRegisterTransfer(from, info);
  }

  private createMaterializedEquivalent(info: RegisterInfo): void {
    const unmaterialized = info.getEquivalentToMaterialize();
    if (unmaterialized) this.outputRegisterTransfer(info, unmaterialized);
  }

  // Everything that is not a transfer.

  /** Breaks every equivalence, storing each live value into the registers that were standing in for it. */
  flush(): void {
    for (const info of this.all()) {
      if (!info.materialized) continue;
      for (let equivalent = info.next; equivalent !== info; equivalent = info.next) {
        if (equivalent.allocated && !equivalent.materialized) this.outputRegisterTransfer(info, equivalent);
        equivalent.moveToNewEquivalenceSet(this.nextEquivalenceId++, true);
      }
    }
  }

  /**
   * Called before an instruction (other than a transfer) is written: flushes before a jump,
   * materializes the accumulator if the instruction reads it, and makes the instruction's
   * writes and clobbers of the accumulator leave its equivalence set. Returns the operands as the
   * instruction must name them, which may be other registers of an equivalence set.
   */
  prepare(opcode: Opcode, operands: readonly Operand[]): Operand[] {
    const bytecode = bytecodeInfo(opcode);
    if (isJump(opcode) || opcode === "Debugger" || opcode === "SuspendGenerator" || opcode === "ResumeGenerator") this.flush();

    const use = bytecode.accumulator;
    if ((use === "read" || use === "readwrite" || use === "read-clobber") && !this.accumulator.materialized) this.materialize(this.accumulator);
    if (use !== "none" && use !== "read") this.prepareOutputRegister(ACCUMULATOR);

    const out: Operand[] = [...operands];
    const types = bytecode.operands;
    for (let i = 0; i < types.length; i++) {
      const type = types[i] as OperandType;
      const value = operands[i];
      if (typeof value !== "number") continue;
      switch (type) {
        case "Reg":
          out[i] = this.inputRegister(value);
          break;
        case "RegOut":
          this.prepareOutputRegister(value);
          break;
        case "RegInOut":
          this.materialize(this.info(value));
          this.prepareOutputRegister(value);
          break;
        case "RegList": {
          const count = Number(operands[i + 1]);
          out[i] = this.inputRegisterList(value, count);
          i++;
          break;
        }
        case "RegPair":
          out[i] = this.inputRegisterList(value, 2);
          break;
        case "RegOutList": {
          const count = Number(operands[i + 1]);
          this.prepareOutputRegisters(value, count);
          i++;
          break;
        }
        case "RegOutPair":
          this.prepareOutputRegisters(value, 2);
          break;
        case "RegOutTriple":
          this.prepareOutputRegisters(value, 3);
          break;
        default:
          break;
      }
    }
    return out;
  }

  /** Hands an instruction built by `prepare` on, with any position that was set aside. */
  emit(node: OptimizerNode): void {
    node.info = mergeSourceInfo(this.deferred, node.info);
    this.deferred = undefined;
    this.sink(node);
  }

  private inputRegister(register: number): number {
    const info = this.info(register);
    if (info.materialized) return register;
    return this.materializedEquivalentNotAccumulator(info).register;
  }

  private materializedEquivalentNotAccumulator(info: RegisterInfo): RegisterInfo {
    if (info.materialized) return info;
    const found = info.getMaterializedEquivalentOtherThan(ACCUMULATOR);
    if (found) return found;
    this.materialize(info);
    return info;
  }

  private inputRegisterList(first: number, count: number): number {
    if (count === 1) return this.inputRegister(first);
    for (let i = 0; i < count; i++) this.materialize(this.info(first - i));
    return first;
  }

  private prepareOutputRegister(register: number): void {
    const info = this.info(register);
    if (info.materialized) this.createMaterializedEquivalent(info);
    info.moveToNewEquivalenceSet(this.nextEquivalenceId++, true);
  }

  private prepareOutputRegisters(first: number, count: number): void {
    for (let i = 0; i < count; i++) this.prepareOutputRegister(first - i);
  }
}
