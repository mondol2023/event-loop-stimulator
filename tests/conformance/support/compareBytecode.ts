import type { ConstantEntry } from "@/core/bytecode/ConstantPool";
import { type BytecodeFunction, type BytecodeProgram, toPrintable } from "@/core/bytecode/BytecodeProgram";
import { type PrintedInstruction, printBytecodeArray } from "@/core/bytecode/printer";
import type { RealFunctionBytecode } from "../../../scripts/conformance/expectation.mts";

// Compares our bytecode for a function with what V8 printed for it, at the two levels the
// fidelity ratchet tracks (PROMPT.md §3.4): `opcodes` (the same mnemonics in the same order) and
// `exact` (everything else too: operands, positions, header numbers, constant pool, handlers).

export type Comparison = { readonly opcodes: boolean; readonly exact: boolean; readonly diffs: string[] };

/** A mnemonic without its `.Wide`/`.ExtraWide` operand-scale suffix. */
function mnemonic(text: string): string {
  return (text.split(" ")[0] ?? "").replace(/\.(Wide|ExtraWide)$/, "");
}

const mark = (position: PrintedInstruction["position"]): string => (position ? `${position.kind}>${position.at}` : "none");

export function compareBytecode(ours: BytecodeFunction, real: RealFunctionBytecode): Comparison {
  const ourPrinted = printBytecodeArray(toPrintable(ours));
  const diffs: string[] = [];

  if (ourPrinted.name !== real.name) diffs.push(`name: ours \`${ourPrinted.name}\`, V8 \`${real.name}\``);
  for (const key of ["length", "parameterCount", "registerCount", "frameSize"] as const) {
    if (ourPrinted.header[key] !== real.header[key]) {
      diffs.push(`header.${key}: ours ${ourPrinted.header[key]}, V8 ${real.header[key]}`);
    }
  }

  const a = ourPrinted.instructions;
  const b = real.instructions;
  let opcodes = a.length === b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const mine = a[i];
    const theirs = b[i];
    if (!mine && theirs) {
      diffs.push(`offset ${theirs.offset}: V8 has \`${theirs.text}\`, ours ends`);
    } else if (mine && !theirs) {
      diffs.push(`offset ${mine.offset}: ours has \`${mine.text}\`, V8 ends`);
    } else if (mine && theirs) {
      if (mnemonic(mine.text) !== mnemonic(theirs.text)) opcodes = false;
      const where = mine.offset === theirs.offset ? `offset ${mine.offset}` : `offset ${mine.offset} (V8 ${theirs.offset})`;
      if (mine.text !== theirs.text) {
        diffs.push(`${where}: ours \`${mine.text}\`, V8 \`${theirs.text}\``);
      } else if (mark(mine.position) !== mark(theirs.position)) {
        diffs.push(`${where}: position ours ${mark(mine.position)}, V8 ${mark(theirs.position)}`);
      } else if (mine.offset !== theirs.offset) {
        diffs.push(`${where}: \`${mine.text}\` is at a different offset`);
      }
    }
  }

  listDiffs(diffs, "constant pool", ourPrinted.constantPool, real.constantPool);
  listDiffs(diffs, "handler table", ourPrinted.handlerTable, real.handlerTable);
  return { opcodes, exact: diffs.length === 0, diffs };
}

function listDiffs(diffs: string[], what: string, ours: readonly string[], real: readonly string[]): void {
  for (let i = 0; i < Math.max(ours.length, real.length); i++) {
    const mine = ours[i];
    const theirs = real[i];
    if (mine === theirs) continue;
    if (mine === undefined) diffs.push(`${what}[${i}]: ours is missing, V8 \`${theirs}\``);
    else if (theirs === undefined) diffs.push(`${what}[${i}]: ours \`${mine}\`, V8 has nothing`);
    else diffs.push(`${what}[${i}]: ours \`${mine}\`, V8 \`${theirs}\``);
  }
}

export type FunctionComparison = { readonly path: string; readonly comparison: Comparison };

/** `#<constant-pool index>:<name>` for each step down from the wrapper; `<root>` is the wrapper. */
export function functionPath(parent: string, index: number, name: string): string {
  return `${parent === "<root>" ? "" : `${parent}/`}#${index}:${name === "" ? "<anonymous>" : name}`;
}

/**
 * Compares the whole tree. Our functions are matched to V8's by the constant-pool index of their
 * shared function info; functions V8 never compiled (it compiles lazily) are not in `real`, and
 * functions of ours with no real block are not compared.
 */
export function compareProgram(program: BytecodeProgram, real: RealFunctionBytecode): FunctionComparison[] {
  const root = program.functions[0];
  if (!root) throw new Error("a bytecode program always has the wrapper function");
  const out: FunctionComparison[] = [];

  const visit = (ours: BytecodeFunction, theirs: RealFunctionBytecode, path: string): void => {
    out.push({ path, comparison: compareBytecode(ours, theirs) });
    for (const [key, child] of Object.entries(theirs.children)) {
      const index = Number(key);
      const entry: ConstantEntry | undefined = ours.constantPool.get(index);
      const childPath = functionPath(path, index, child.name);
      const mine = entry?.kind === "sfi" ? program.functions[entry.functionId] : undefined;
      if (mine) {
        visit(mine, child, childPath);
      } else {
        out.push({
          path: childPath,
          comparison: { opcodes: false, exact: false, diffs: [`constant pool[${index}]: ours has no function for V8's \`${child.name}\``] },
        });
      }
    }
  };
  visit(root, real, "<root>");
  return out;
}
