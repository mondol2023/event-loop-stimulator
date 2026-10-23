import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "../../core/shared/zod";
import { ASM_EXPECTED_FILE, collectAsmForms } from "../../scripts/conformance/asm-forms.mts";

// Every x64 form the baseline compiler emits for the fixtures equals what llvm-mc encoded (recorded by
// `npm run asm:record`), checked offline. Until the first record the golden is an it.todo, and the
// tripwire below keeps that state from hiding a real gap.

const ExpectedSchema = z.object({ llvm: z.string(), forms: z.record(z.string(), z.string()) }).strict();

const forms = collectAsmForms();

describe("encoded forms equal llvm-mc", () => {
  if (existsSync(ASM_EXPECTED_FILE)) {
    const expected = ExpectedSchema.parse(JSON.parse(readFileSync(ASM_EXPECTED_FILE, "utf8")));
    for (const form of forms) {
      it(form.key, () => {
        expect(expected.forms[form.key], `no llvm-mc encoding recorded for "${form.key}": run npm run asm:record`).toBe(form.bytes);
      });
    }
    it("records no form the compiler no longer emits", () => {
      const live = new Set(forms.map((f) => f.key));
      expect(Object.keys(expected.forms).filter((k) => !live.has(k))).toEqual([]);
    });
  } else {
    it.todo("every encoded form matches llvm-mc (awaiting the first `npm run asm:record`, which needs llvm-mc)");
    // Tripwire: the todo is only honest while there are forms to record, and the path must stay the one the script writes.
    it("tripwire: forms exist that the missing golden would cover", () => {
      expect(forms.length, "the compiler emits forms but asm/encodings.expected.json is missing: record it").toBeGreaterThan(0);
      expect(ASM_EXPECTED_FILE.replace(/\\/g, "/")).toMatch(/tests\/conformance\/asm\/encodings\.expected\.json$/);
    });
  }
});
