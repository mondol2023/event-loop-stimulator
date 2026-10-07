import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderExcludedTable, SUBSET_DOC_TABLE_BEGIN, SUBSET_DOC_TABLE_END } from "../core/frontend/subset/excluded.ts";

// Regenerates the "Excluded" tables of docs/SUPPORTED_SUBSET.md and docs/FIDELITY.md from
// core/frontend/subset/excluded.ts. tests/tooling/subset-docs.test.ts fails when they drift.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  { file: "docs/SUPPORTED_SUBSET.md", flavor: "subset" },
  { file: "docs/FIDELITY.md", flavor: "fidelity" },
] as const;

/** `markdown` with everything between (and including) the table markers replaced by the fresh table. */
export function withTable(markdown: string, flavor: "subset" | "fidelity"): string {
  const begin = markdown.indexOf(SUBSET_DOC_TABLE_BEGIN);
  const end = markdown.indexOf(SUBSET_DOC_TABLE_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`missing ${SUBSET_DOC_TABLE_BEGIN} ... ${SUBSET_DOC_TABLE_END} markers`);
  }
  return markdown.slice(0, begin) + renderExcludedTable(flavor) + markdown.slice(end + SUBSET_DOC_TABLE_END.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const { file, flavor } of TARGETS) {
    const path = join(ROOT, file);
    const before = readFileSync(path, "utf8");
    const after = withTable(before, flavor);
    if (after !== before) writeFileSync(path, after);
    console.log(`${file}: ${after === before ? "up to date" : "updated"}`);
  }
}
