import type { Program } from "estree";
import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import type { SourceRange } from "@/core/shared/diagnostics";
import type { FunctionId } from "@/core/shared/ids";

// What every code view shares (PROMPT.md §7.3): a view turns the compiled program into lines of
// text, and each line says which bytecode it stands for so the UI can highlight the same thing in
// the editor and in every other view. Only `ast` and `bytecode` exist so far; `asm` and `binary`
// arrive with the machine-code phase.

/** One instruction of one function. */
export type BytecodePos = { readonly functionId: FunctionId; readonly bytecodeOffset: number };

export type EmittedLine = {
  readonly text: string;
  /** The bytecode this line corresponds to, ordered by function then offset. */
  readonly positions: readonly BytecodePos[];
};

export type EmitContext = {
  /** The text that was parsed; every range indexes into it. */
  readonly source: string;
  readonly ast: Program;
};

export interface CodeViewStrategy<TOut> {
  readonly id: "ast" | "bytecode" | "asm" | "binary";
  emit(program: BytecodeProgram, ctx: EmitContext): TOut;
}

// ---- source <-> bytecode ------------------------------------------------------------------
//
// V8's source position table is sparse: an entry attaches a source position to one bytecode, and
// the bytecodes after it, up to the next entry, are attributed to the same position. Both
// directions below use that attribution, so they are inverses of each other.

type Attribution = { readonly position: number; readonly pos: BytecodePos };

const indexes = new WeakMap<BytecodeProgram, readonly Attribution[]>();

/** Every instruction with the source position it is attributed to, sorted by that position. */
function attributions(program: BytecodeProgram): readonly Attribution[] {
  const cached = indexes.get(program);
  if (cached) return cached;
  const list: Attribution[] = [];
  for (const fn of program.functions) {
    const entries = fn.positions.entries;
    let next = 0;
    let current: number | undefined;
    for (const instruction of fn.array.instructions) {
      while (next < entries.length && (entries[next]?.offset ?? Infinity) <= instruction.offset) {
        current = entries[next]?.position;
        next++;
      }
      if (current !== undefined) list.push({ position: current, pos: { functionId: fn.id, bytecodeOffset: instruction.offset } });
    }
  }
  list.sort((a, b) => a.position - b.position || a.pos.functionId - b.pos.functionId || a.pos.bytecodeOffset - b.pos.bytecodeOffset);
  indexes.set(program, list);
  return list;
}

/** Every instruction attributed to a source position inside `range`, ordered by function then offset. */
export function positionsForSourceRange(program: BytecodeProgram, range: SourceRange): BytecodePos[] {
  const list = attributions(program);
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((list[mid]?.position ?? Infinity) < range.start) low = mid + 1;
    else high = mid;
  }
  const found: BytecodePos[] = [];
  for (let i = low; i < list.length; i++) {
    const entry = list[i];
    if (!entry || entry.position >= range.end) break;
    found.push(entry.pos);
  }
  return found.sort((a, b) => a.functionId - b.functionId || a.bytecodeOffset - b.bytecodeOffset);
}

/**
 * The source the instruction at `pos` is attributed to: the one code unit V8 recorded, since the
 * table keeps a point and not an extent. `undefined` when the function does not exist, the offset is
 * outside it, or no position has been recorded at or before it.
 */
export function sourceRangeForPos(program: BytecodeProgram, pos: BytecodePos): SourceRange | undefined {
  const fn = program.functions[pos.functionId];
  if (!fn || pos.bytecodeOffset < 0 || pos.bytecodeOffset >= fn.array.length) return undefined;
  let position: number | undefined;
  for (const entry of fn.positions.entries) {
    if (entry.offset > pos.bytecodeOffset) break;
    position = entry.position;
  }
  return position === undefined ? undefined : { start: position, end: position + 1 };
}
