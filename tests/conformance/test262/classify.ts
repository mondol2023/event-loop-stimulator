import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { checkSourceLimits, validateSubset } from "@/core/frontend/subset/validator";
import type { Metadata } from "./metadata";

// Which test262 tests the subset can run (PROMPT.md §3.4). The harness itself (`assert.*`,
// `Test262Error`, `$DONE`, `print`) is provided by the simulator as builtins, so a test may
// include only the harness files whose API that covers; see harnessContract.md.

export const EXCLUSION_REASONS = ["include", "flag", "feature", "negative", "parse", "validator", "size", "metadata"] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export type Classification =
  | { readonly inSubset: true }
  | { readonly inSubset: false; readonly reason: ExclusionReason; readonly detail?: string };

/** Harness files whose API the simulator provides as builtins. */
export const PROVIDED_INCLUDES: ReadonlySet<string> = new Set(["assert.js", "sta.js", "doneprintHandle.js"]);

/** Flags the subset can honour; every other flag (module, raw, CanBlockIs*, …) excludes the test. */
export const SUPPORTED_FLAGS: ReadonlySet<string> = new Set(["async", "onlyStrict", "noStrict", "generated"]);

export const SUPPORTED_FEATURES: ReadonlySet<string> = new Set([
  "Promise",
  "Promise.allSettled",
  "Promise.any",
  "Promise.prototype.finally",
  "async-functions",
  "arrow-function",
  "let",
  "const",
  "template",
  "default-parameters",
  "optional-chaining",
  "coalesce-expression",
  "exponentiation",
  "logical-assignment-operators",
  "numeric-separator-literal",
  "Array.prototype.includes",
  "AggregateError",
]);

export type Mode = "sloppy" | "strict";

/** The runs a test needs: both modes unless a flag restricts it. */
export function modeSources(source: string, meta: Metadata): { mode: Mode; source: string }[] {
  const sloppy = { mode: "sloppy" as const, source };
  const strict = { mode: "strict" as const, source: `"use strict";\n${source}` };
  if (meta.flags.includes("onlyStrict")) return [strict];
  if (meta.flags.includes("noStrict")) return [sloppy];
  return [sloppy, strict];
}

const excluded = (reason: ExclusionReason, detail?: string): Classification =>
  detail === undefined ? { inSubset: false, reason } : { inSubset: false, reason, detail };

export function classify(source: string, meta: Metadata | undefined): Classification {
  if (!meta) return excluded("metadata");

  const flag = meta.flags.find((f) => !SUPPORTED_FLAGS.has(f));
  if (flag) return excluded("flag", flag);
  const include = meta.includes.find((i) => !PROVIDED_INCLUDES.has(i));
  if (include) return excluded("include", include);
  const feature = meta.features.find((f) => !SUPPORTED_FEATURES.has(f));
  if (feature) return excluded("feature", feature);
  if (meta.negative && meta.negative.phase !== "parse" && meta.negative.phase !== "runtime") {
    return excluded("negative", meta.negative.phase);
  }

  for (const run of modeSources(source, meta)) {
    if (checkSourceLimits(run.source).length > 0) return excluded("size", run.mode);
    const parsed = parseScript(run.source);
    if (meta.negative?.phase === "parse") {
      // We only claim a test whose early error our own parser also reports.
      if (parsed.ok) return excluded("parse", `${run.mode}: parsed without an error`);
      continue;
    }
    if (!parsed.ok) return excluded("parse", `${run.mode}: ${parsed.error[0]?.message ?? "syntax error"}`);
    const first = validateSubset(parsed.value, analyzeScopes(parsed.value))[0];
    if (first) return excluded("validator", `${first.code} ${run.source.slice(first.range.start, first.range.end)}`);
  }
  return { inSubset: true };
}
