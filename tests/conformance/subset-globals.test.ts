import { describe, expect, it } from "vitest";
import {
  ALLOWED_GLOBALS,
  NAMESPACE_MEMBERS,
  NODE_GLOBALS,
  SPECIFIC_EXCLUDED_GLOBALS,
} from "@/core/frontend/subset/excluded";
import { runReal } from "../../scripts/conformance/run-real.mts";
import { checkPinnedRuntime, readTarget } from "../../scripts/conformance/target.mts";

// NODE_GLOBALS decides which unresolved names the validator refuses (a name outside the
// list is a real ReferenceError that we model exactly), so it is re-derived from the
// pinned Node here. Skipped, not weakened, on any other runtime.
const problems = checkPinnedRuntime({ node: process.versions.node, v8: process.versions.v8 }, readTarget());
if (problems.length > 0) console.warn(`Skipping subset-globals test: ${problems.join("; ")} (docs/TARGET.md)`);

describe("the Node global list", () => {
  it("is sorted and free of duplicates", () => {
    expect([...NODE_GLOBALS]).toEqual([...new Set(NODE_GLOBALS)].sort());
  });

  it("covers every name the tables mention", () => {
    for (const name of [...ALLOWED_GLOBALS, ...Object.keys(SPECIFIC_EXCLUDED_GLOBALS), ...Object.keys(NAMESPACE_MEMBERS)]) {
      expect(NODE_GLOBALS, name).toContain(name);
    }
  });

  it.skipIf(problems.length > 0)("equals the own properties of globalThis in a main script on the pinned Node", () => {
    const run = runReal("console.log(JSON.stringify(Object.getOwnPropertyNames(globalThis).sort()))", { lang: "js" });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout) as string[]).toEqual([...NODE_GLOBALS]);
  });
});
