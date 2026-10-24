import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "../../core/shared/zod";
import { ASM_EXPECTED_FILE, collectAsmForms } from "../../scripts/conformance/asm-forms.mts";

// Every x64 form the baseline compiler emits equals what llvm-mc encoded (`npm run asm:record`), checked offline; until the first record it is an it.todo plus a tripwire.

const ExpectedSchema = z.object({ llvm: z.string(), assembler: z.object({ tool: z.enum(["llvm-mc", "clang"]), version: z.string() }).strict().optional(), forms: z.record(z.string(), z.string()) }).strict();

const { forms, skipped } = collectAsmForms();
const SHOWN = 10;

describe("encoded forms equal llvm-mc", () => {
  if (existsSync(ASM_EXPECTED_FILE)) {
    it("the compiled forms and the recorded forms are the same set with the same bytes", () => {
      const expected = ExpectedSchema.parse(JSON.parse(readFileSync(ASM_EXPECTED_FILE, "utf8")));
      expect(forms.length, "the compiler emitted no forms").toBeGreaterThan(0);
      expect(Object.keys(expected.forms).length, "the golden records no forms").toBeGreaterThan(0);
      const live = new Map(forms.map((f) => [f.key, f.bytes]));
      const wrong = [...live].filter(([k, bytes]) => expected.forms[k] !== bytes).map(([k, bytes]) => `${k}: encoder ${bytes}, llvm-mc ${expected.forms[k] ?? "(missing)"}`);
      const stale = Object.keys(expected.forms).filter((k) => !live.has(k));
      const report = (title: string, rows: string[]): string => (rows.length === 0 ? "" : `${title} (${rows.length}): ${rows.slice(0, SHOWN).join(" | ")}\n`);
      expect(`${report("missing or different", wrong)}${report("stale", stale)}`, "run npm run asm:record").toBe("");
    });
  } else {
    it.todo("every encoded form matches llvm-mc (awaiting the first `npm run asm:record`, which needs llvm-mc)");
    // Tripwire: the todo is only honest while there are forms to record; the skipped-fixture count is printed so a jump is visible.
    it("tripwire: forms exist that the missing golden would cover", () => {
      console.log(`asm golden missing: ${forms.length} forms, ${skipped.length} refused fixtures skipped (${skipped.map((s) => s.fixture).join(", ")})`);
      expect(forms.length, "the compiler emits forms but asm/encodings.expected.json is missing: record it").toBeGreaterThan(0);
      expect(ASM_EXPECTED_FILE.replaceAll("\\", "/")).toMatch(/tests\/conformance\/asm\/encodings\.expected\.json$/);
    });
  }
});
