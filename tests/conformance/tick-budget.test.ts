import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverFixtures } from "../../scripts/conformance/fixtures.mts";
import { LIMITS } from "@/core/timeline/limits";
import { simulate } from "@/core/timeline/simulate";

// The D4 gate: every program must fit the 5,000-tick limit, or the human decides between
// another granularity and another limit (the plan forbids choosing silently). The owner chose
// statement-level ticks when per-dispatch ticks put recursion-factorial at 28,491.

const ROOT = dirname(fileURLToPath(import.meta.url));
const RUNNABLE = discoverFixtures(ROOT).filter((f) => f.kind === "program" && f.meta.expect !== "refused");

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

  // The vendored test262 tests need the test262 host (Task 23), so they are measured there.
  it.todo("every vendored test262 test runs within the tick limit (measured when Task 23 adds the host)");
});
