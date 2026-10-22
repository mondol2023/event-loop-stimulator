import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { CompileInput } from "@/server/validation/compile";
import { parseExpectation } from "../../scripts/conformance/expectation.mts";
import { extractFeedback } from "../../scripts/conformance/feedback.mts";
import { discoverFixtures, expectationFile } from "../../scripts/conformance/fixtures.mts";
import { compareToExpectation } from "./runner";
import { simulatorRun } from "./support/simulator";

// The `internals` fixtures are V8-native probes (%HaveSameMap, %HasSmiElements, %DebugPrint, ...)
// recorded under --allow-natives-syntax. Natives mode (Decision D2) compiles them to CallRuntime
// over our Map, elements-kind and IC model, and the output must equal real node's byte for byte.

const CONFORMANCE_ROOT = dirname(fileURLToPath(import.meta.url));

const INTERNALS_FIXTURES = discoverFixtures(CONFORMANCE_ROOT).filter((f) => f.kind === "internals");

describe("internals fixtures in natives mode equal real node", () => {
  it("has internals fixtures to compare", () => {
    expect(INTERNALS_FIXTURES.length).toBeGreaterThan(0);
  });

  for (const fixture of INTERNALS_FIXTURES) {
    it(fixture.name, () => {
      const expectation = parseExpectation(JSON.parse(readFileSync(join(CONFORMANCE_ROOT, expectationFile(fixture)), "utf8")));
      const run = simulatorRun(fixture, { natives: true });
      // The recorder kept only the extracted lines of real node's stdout; ours goes through the same filter.
      const sim = fixture.meta.extract === "feedback" ? { ...run, stdout: extractFeedback(run.stdout) } : run;
      const comparison = compareToExpectation(sim, expectation, fixture.meta);
      expect(comparison.ok, comparison.ok ? "" : comparison.diff).toBe(true);
    });
  }
});

describe("natives mode is unreachable from user input (D2)", () => {
  it("the /api/compile input schema rejects a natives flag", () => {
    expect(CompileInput.safeParse({ code: "%HaveSameMap(a, b)", lang: "js", natives: true }).success).toBe(false);
  });

  it("without the option, %Name(...) is a syntax error", () => {
    const result = new CompilationManager().compile("const a = {}; const b = {}; %HaveSameMap(a, b);", "js");
    expect(result.program).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("E_SYNTAX");
  });

  it("an intrinsic outside the allowlist is refused even in natives mode", () => {
    const result = new CompilationManager().compile("%OptimizeFunctionOnNextCall(f);", "js", { natives: true });
    expect(result.program).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
