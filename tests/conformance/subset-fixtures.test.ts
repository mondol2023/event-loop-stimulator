import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { stripTypes } from "@/core/frontend/strip-types";
import { validateSubset } from "@/core/frontend/subset/validator";
import { discoverFixtures } from "../../scripts/conformance/fixtures.mts";

// The subset is defined by the fixtures: every program that real node ran (and we
// must therefore reproduce) has to pass the frontend with no diagnostic, and every
// fixture node refused must be refused by us too.

const ROOT = dirname(fileURLToPath(import.meta.url));
const programs = discoverFixtures(ROOT).filter((f) => f.kind === "program");

describe("every runnable program fixture passes the frontend", () => {
  for (const fixture of programs.filter((f) => f.meta.expect !== "refused")) {
    it(fixture.name, () => {
      let js = fixture.source;
      if (fixture.lang === "ts") {
        const stripped = stripTypes(js);
        if (!stripped.ok) throw new Error(`strip failed: ${JSON.stringify(stripped.error)}`);
        js = stripped.value;
      }
      const parsed = parseScript(js);
      if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`);
      const diagnostics = validateSubset(parsed.value, analyzeScopes(parsed.value));
      const shown = diagnostics.map((d) => `${d.code} ${JSON.stringify(js.slice(d.range.start, d.range.end))}: ${d.message}`);
      expect(shown).toEqual([]);
    });
  }

  it("has runnable fixtures to check", () => {
    expect(programs.filter((f) => f.meta.expect !== "refused").length).toBeGreaterThan(10);
  });
});

describe("fixtures node refused are refused by stripTypes", () => {
  const refused = programs.filter((f) => f.meta.expect === "refused");
  for (const fixture of refused) {
    it(fixture.name, () => {
      expect(fixture.lang).toBe("ts");
      const stripped = stripTypes(fixture.source);
      expect(stripped.ok).toBe(false);
    });
  }

  it("has refused fixtures to check", () => {
    expect(refused.length).toBeGreaterThan(0);
  });
});
