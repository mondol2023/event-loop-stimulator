// Maps bytecode offsets to source positions (V8's SourcePositionTable): the `S>` and `E>` marks
// in a listing. A statement position (`S>`) marks where a statement starts and is where a
// debugger can break; an expression position (`E>`) marks an operation that can throw.

export type PositionKind = "statement" | "expression";

export type SourcePositionEntry = {
  readonly offset: number;
  /** A UTF-16 offset into the source. */
  readonly position: number;
  readonly kind: PositionKind;
};

export class SourcePositionTable {
  private readonly list: SourcePositionEntry[] = [];

  get entries(): readonly SourcePositionEntry[] {
    return this.list;
  }

  /**
   * Records `position` at `offset`. Offsets must not decrease. At an offset that already has an
   * entry a statement position beats an expression position whichever came first; two of the same
   * kind keep the later one.
   */
  add(offset: number, position: number, kind: PositionKind): void {
    const last = this.list.at(-1);
    if (last && offset < last.offset) throw new Error(`source position offset ${offset} before ${last.offset}`);
    if (last && last.offset === offset) {
      if (last.kind === "statement" && kind === "expression") return;
      this.list[this.list.length - 1] = { offset, position, kind };
      return;
    }
    this.list.push({ offset, position, kind });
  }

  /** The entry recorded at exactly `offset`. */
  at(offset: number): SourcePositionEntry | undefined {
    return this.list.find((entry) => entry.offset === offset);
  }
}
