import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXCLUDED,
  renderExcludedTable,
  SUBSET_DOC_TABLE_BEGIN,
  SUBSET_DOC_TABLE_END,
} from "@/core/frontend/subset/excluded";
import { withTable } from "../../scripts/subset-docs.mts";

// The excluded-construct tables in the docs are generated from the validator's own table;
// editing one by hand (or the table without regenerating) fails here.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

describe("generated excluded tables", () => {
  for (const [file, flavor] of [
    ["docs/SUPPORTED_SUBSET.md", "subset"],
    ["docs/FIDELITY.md", "fidelity"],
  ] as const) {
    it(`${file} matches the table (run \`npm run docs:subset\`)`, () => {
      const doc = read(file);
      expect(doc).toContain(SUBSET_DOC_TABLE_BEGIN);
      expect(withTable(doc, flavor)).toBe(doc);
    });
  }

  it("lists every entry exactly once, with a distinct id", () => {
    const ids = EXCLUDED.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const table = renderExcludedTable("subset");
    expect(table.startsWith(SUBSET_DOC_TABLE_BEGIN)).toBe(true);
    expect(table.endsWith(SUBSET_DOC_TABLE_END)).toBe(true);
    expect(table.split("\n").filter((l) => l.startsWith("| ")).length).toBe(EXCLUDED.length + 1);
  });

  it("every entry has a real message, hint and reason", () => {
    for (const e of EXCLUDED) {
      expect(e.message.length, e.id).toBeGreaterThan(10);
      expect(e.hint.length, e.id).toBeGreaterThan(10);
      expect(e.reason.length, e.id).toBeGreaterThan(10);
    }
  });
});
