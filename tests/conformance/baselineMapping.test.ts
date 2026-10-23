import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { programArbitrary } from "./generator/programs";

// The Asm and Binary views against the bytecode: every line points at a real decoded instruction, and every
// decoded instruction has at least one line in each view (V8 may emit nothing for a bytecode; this model never does).

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const manager = new CompilationManager();

function check(source: string): void {
  const { program, views } = manager.compile(source, "js", { natives: true });
  if (!program || !views) return; // a source the front end refuses has no views to map
  for (const kind of ["asm", "binary"] as const) {
    for (const fn of program.functions) {
      const view = views[kind].functions[fn.id];
      expect(view?.unavailable, `${kind} of function ${fn.id}`).toBeUndefined();
      const offsets = new Set(fn.array.instructions.map((i) => i.offset));
      const seen = new Set<number>();
      for (const line of view?.lines ?? []) {
        for (const pos of line.positions) {
          expect(pos.functionId).toBe(fn.id);
          expect(offsets.has(pos.bytecodeOffset), `${kind} line "${line.text}" points at offset ${pos.bytecodeOffset}`).toBe(true);
          seen.add(pos.bytecodeOffset);
        }
      }
      for (const offset of offsets) expect(seen.has(offset), `${kind} of function ${fn.id} has no line for bytecode offset ${offset}`).toBe(true);
    }
    expect(views[kind].functions.length).toBe(program.functions.length);
  }
  for (const [i, asmFn] of views.asm.functions.entries()) expect(asmFn.lines.length).toBe(views.binary.functions[i]?.lines.length);
}

describe("baseline code maps to bytecode", () => {
  const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith(".cjs"));

  it.each(fixtures)("fixture %s", (file) => {
    check(readFileSync(join(FIXTURES, file), "utf8"));
  });

  it("generated subset programs", () => {
    fc.assert(
      fc.property(programArbitrary, (source) => check(source)),
      { numRuns: 50, seed: 4 },
    );
  });
});
