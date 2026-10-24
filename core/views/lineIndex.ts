import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import { lineColumn } from "@/core/shared/diagnostics";
import type { AsmViewOutput } from "./AsmView";
import type { AstViewOutput } from "./AstView";
import type { BinaryViewOutput } from "./BinaryView";
import type { BytecodeViewOutput } from "./BytecodeView";
import { type BytecodePos, sourceAttributions } from "./types";

export type Pane = "source" | "ast" | "bytecode" | "asm" | "binary";

type Lines = readonly (readonly BytecodePos[])[];

/** Line (0-based) to bytecode positions, per pane. Plain data: it crosses the worker boundary. */
export type LineIndex = {
  readonly panes: Readonly<Record<Exclude<Pane, "source">, Lines>>;
  readonly source: Lines;
};

const keyOf = (p: BytecodePos): string => `${p.functionId}:${p.bytecodeOffset}`;

function flatten(functions: readonly { readonly lines: readonly { readonly positions: readonly BytecodePos[] }[] }[]): Lines {
  return functions.flatMap((fn) => fn.lines.map((l) => l.positions));
}

export function buildLineIndex(
  program: BytecodeProgram,
  views: { ast: AstViewOutput; bytecode: BytecodeViewOutput; asm: AsmViewOutput; binary: BinaryViewOutput },
  strippedJs: string,
): LineIndex {
  const source: BytecodePos[][] = [];
  for (const { position, pos } of sourceAttributions(program)) {
    const line = lineColumn(strippedJs, position).line - 1;
    (source[line] ??= []).push(pos);
  }
  for (let i = 0; i < source.length; i++) source[i] ??= [];
  return {
    source: source.map((l) => l.slice().sort((a, b) => a.functionId - b.functionId || a.bytecodeOffset - b.bytecodeOffset)),
    panes: {
      ast: views.ast.lines.map((l) => l.positions),
      bytecode: flatten(views.bytecode.functions),
      asm: flatten(views.asm.functions),
      binary: flatten(views.binary.functions),
    },
  };
}

function linesOf(index: LineIndex, pane: Pane): Lines {
  return pane === "source" ? index.source : index.panes[pane];
}

/** The 0-based lines of `pane` holding any of `positions`; sorted and unique. */
export function linesForPositions(index: LineIndex, pane: Pane, positions: readonly BytecodePos[]): number[] {
  if (positions.length === 0) return [];
  const wanted = new Set(positions.map(keyOf));
  const found: number[] = [];
  linesOf(index, pane).forEach((line, i) => {
    if (line?.some((p) => wanted.has(keyOf(p)))) found.push(i);
  });
  return found;
}

export function positionsForLine(index: LineIndex, pane: Pane, line: number): readonly BytecodePos[] {
  if (!Number.isInteger(line) || line < 0) return [];
  return linesOf(index, pane)[line] ?? [];
}
