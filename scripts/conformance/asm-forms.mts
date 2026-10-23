import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileBaseline } from "../../core/baseline/BaselineCompiler.ts";
import { CompilationManager } from "../../core/compile/CompilationManager.ts";
import { discoverFixtures } from "./fixtures.mts";

// Every distinct encoded x64 form the baseline compiler emits for the conformance fixtures. Shared by
// `npm run asm:record` (which asks llvm-mc for the bytes) and asm.test.ts (which checks them offline).

export type AsmForm = {
  /** The identity of the form: AT&T text, with a branch target replaced by its signed displacement. */
  readonly key: string;
  /** What llvm-mc is fed: the AT&T text, or for a branch a label placed `disp` bytes away. */
  readonly source: string;
  /** The encoder's bytes, lowercase hex without separators. */
  readonly bytes: string;
};

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFORMANCE_ROOT = join(HERE, "..", "..", "tests", "conformance");
export const ASM_EXPECTED_FILE = join(CONFORMANCE_ROOT, "asm", "encodings.expected.json");

function signedLe(bytes: readonly number[]): number {
  let value = 0;
  bytes.forEach((b, i) => (value += b * 2 ** (8 * i)));
  const bits = 8 * bytes.length;
  return value >= 2 ** (bits - 1) ? value - 2 ** bits : value;
}

function formOf(asm: string, bytes: readonly number[], branch: boolean): AsmForm {
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!branch) return { key: asm, source: asm, bytes: hex };
  // rel8 forms are two bytes (opcode + disp8); every other branch ends in a disp32.
  const disp = signedLe(bytes.slice(bytes.length === 2 ? 1 : -4));
  const op = asm.slice(0, asm.lastIndexOf(" "));
  const key = `${op} rel${disp >= 0 ? "+" : ""}${disp}`;
  // llvm-mc relaxes to the same width for the same distance, so a label `disp` bytes away reproduces the form.
  const source = disp >= 0 ? `${op} 1f\n.fill ${disp},1,0x90\n1:` : `1:\n.fill ${-disp - bytes.length},1,0x90\n${op} 1b`;
  return { key, source, bytes: hex };
}

export type SkippedFixture = { readonly fixture: string; readonly reason: string };

export function collectAsmForms(): { forms: AsmForm[]; skipped: SkippedFixture[] } {
  const manager = new CompilationManager();
  const forms = new Map<string, AsmForm>();
  const skipped: SkippedFixture[] = [];
  for (const fixture of discoverFixtures(CONFORMANCE_ROOT)) {
    const { program, diagnostics } = manager.compile(fixture.source, fixture.lang, { natives: true });
    if (!program) {
      // A source the front end refuses has no code to encode; it is counted, never silently dropped.
      skipped.push({ fixture: fixture.file, reason: diagnostics.map((d) => d.code).join(", ") || "no program" });
      continue;
    }
    for (const fn of program.functions) {
      const code = compileBaseline(fn);
      // A compiler or encoder failure on accepted code must not shrink coverage quietly.
      if (!code.ok) throw new Error(`baseline compile failed for ${fixture.file} function ${fn.id}: ${code.error.map((e) => e.message).join("; ")}`);
      for (const ins of code.value.instructions) {
        const form = formOf(ins.asm, ins.bytes, ins.instruction.operands[0]?.kind === "label");
        const prior = forms.get(form.key);
        if (prior !== undefined && prior.bytes !== form.bytes) throw new Error(`the encoder gave "${form.key}" two encodings: ${prior.bytes} and ${form.bytes}`);
        forms.set(form.key, form);
      }
    }
  }
  return { forms: [...forms.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)), skipped };
}
