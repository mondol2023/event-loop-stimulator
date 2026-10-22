import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverFixtures } from "../../scripts/conformance/fixtures.mts";
import { LIMITS } from "@/core/timeline/limits";
import { simulate } from "@/core/timeline/simulate";
import { modeSources } from "./test262/classify";
import { parseMetadata } from "./test262/metadata";

// The D4 gate: every program must fit the 5,000-tick limit, or the human decides between
// another granularity and another limit (the plan forbids choosing silently). The owner chose
// statement-level ticks when per-dispatch ticks put recursion-factorial at 28,491.

const ROOT = dirname(fileURLToPath(import.meta.url));
const RUNNABLE = discoverFixtures(ROOT).filter((f) => f.kind === "program" && f.meta.expect !== "refused");
const TEST262 = join(ROOT, "..", "..", "vendor", "test262", "test");

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : name.endsWith(".js") ? [full] : [];
    });
}

describe("tick budget (D4 gate)", () => {
  it(`every program fixture runs to the end within ${LIMITS.ticks} ticks`, () => {
    const over: string[] = [];
    for (const fixture of RUNNABLE) {
      const r = simulate(fixture.source, fixture.lang, { record: false });
      if (r.stop?.kind === "limit" && r.stop.limit === "ticks") over.push(`${fixture.name}: more than ${LIMITS.ticks}`);
      else expect(r.tickCount, fixture.name).toBeLessThanOrEqual(LIMITS.ticks);
    }
    expect(over).toEqual([]);
  });

  it(`every vendored test262 test runs within ${LIMITS.ticks} ticks under the test262 host, in each mode`, () => {
    const over: string[] = [];
    for (const file of existsSync(TEST262) ? walk(TEST262) : []) {
      const source = readFileSync(file, "utf8");
      for (const run of modeSources(source, parseMetadata(source))) {
        const r = simulate(run.source, "js", { record: false, host: "test262" });
        if ((r.stop?.kind === "limit" && r.stop.limit === "ticks") || r.tickCount > LIMITS.ticks) over.push(`${file.slice(TEST262.length + 1)} (${run.mode})`);
      }
    }
    expect(over).toEqual([]);
  }, 300_000);
});
