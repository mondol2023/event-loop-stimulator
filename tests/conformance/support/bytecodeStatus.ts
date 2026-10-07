import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateBytecode } from "@/core/bytecode/BytecodeGenerator";
import { stripTypes } from "@/core/frontend/strip-types";
import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { z } from "@/core/shared/zod";
import { type RealFunctionBytecode, parseExpectation } from "../../../scripts/conformance/expectation.mts";
import { type Fixture, discoverFixtures, expectationFile } from "../../../scripts/conformance/fixtures.mts";
import { compareProgram } from "./compareBytecode";

// The bytecode fidelity ratchet's bookkeeping (PROMPT.md §3.4). `bytecode-status.json` records, for
// every program fixture that has recorded bytecode, how closely our bytecode matches V8's:
//
//   pending  the generator cannot compile it yet, or some function differs from V8 in its opcodes
//   opcodes  every function has V8's opcodes; the functions that are not exact are listed as
//            "operands" exceptions, each with a reason
//   exact    every function is identical to V8's, positions, operands, pool and handlers included
//
// A function whose opcodes differ from V8's can still be accepted, as a documented "opcodes"
// exception, when the difference is understood and explained. The test fails when reality is
// better than the record as well as when it is worse, so the file only ever moves forward.

export const CONFORMANCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const STATUS_FILE = join(CONFORMANCE_ROOT, "bytecode-status.json");

const ExceptionSchema = z
  .object({ function: z.string().min(1), level: z.enum(["opcodes", "operands"]), reason: z.string() })
  .strict();
const EntrySchema = z
  .object({ status: z.enum(["pending", "opcodes", "exact"]), exceptions: z.array(ExceptionSchema).optional() })
  .strict();
export const StatusFileSchema = z.record(z.string(), EntrySchema);

export type StatusException = z.infer<typeof ExceptionSchema>;
export type StatusEntry = z.infer<typeof EntrySchema>;
export type StatusFile = z.infer<typeof StatusFileSchema>;
export type Status = StatusEntry["status"];

export type FunctionLevel = "exact" | "opcodes" | "none";

export type FunctionResult = { readonly path: string; readonly level: FunctionLevel; readonly diffs: readonly string[] };

export type FixtureOutcome = {
  readonly fixture: string;
  readonly real: RealFunctionBytecode;
  /** Why the generator could not compile the program, if it could not. */
  readonly refusal?: string;
  readonly functions: readonly FunctionResult[];
};

/** Fixtures the ratchet covers: programs V8 compiled and that the playground is expected to accept. */
export function ratchetFixtures(): { fixture: Fixture; real: RealFunctionBytecode }[] {
  const out: { fixture: Fixture; real: RealFunctionBytecode }[] = [];
  for (const fixture of discoverFixtures(CONFORMANCE_ROOT)) {
    if (fixture.kind !== "program" || fixture.meta.expect === "refused") continue;
    const file = join(CONFORMANCE_ROOT, expectationFile(fixture));
    if (!existsSync(file)) continue;
    const expectation = parseExpectation(JSON.parse(readFileSync(file, "utf8")));
    if (expectation.bytecode) out.push({ fixture, real: expectation.bytecode });
  }
  return out;
}

/** Runs the pipeline on a fixture and compares every function with what V8 printed. */
export function measure(fixture: Fixture, real: RealFunctionBytecode): FixtureOutcome {
  const base = { fixture: fixture.name, real };
  let js = fixture.source;
  if (fixture.lang === "ts") {
    const stripped = stripTypes(js);
    if (!stripped.ok) return { ...base, refusal: stripped.error[0]?.message ?? "type stripping failed", functions: [] };
    js = stripped.value;
  }
  const parsed = parseScript(js);
  if (!parsed.ok) return { ...base, refusal: parsed.error[0]?.message ?? "parse failed", functions: [] };
  const generated = generateBytecode(parsed.value, analyzeScopes(parsed.value));
  if (!generated.ok) return { ...base, refusal: generated.error[0]?.message ?? "not compiled", functions: [] };
  return {
    ...base,
    functions: compareProgram(generated.value, real).map(({ path, comparison }) => ({
      path,
      level: comparison.exact ? "exact" : comparison.opcodes ? "opcodes" : "none",
      diffs: comparison.diffs,
    })),
  };
}

const PLACEHOLDER = "TODO: explain this difference";

/**
 * The entry that describes `outcome` truthfully, keeping the reasons already recorded in
 * `recorded` for exceptions that still apply. New exceptions get a TODO reason, which the ratchet
 * test refuses until someone writes the explanation.
 */
export function describeOutcome(outcome: FixtureOutcome, recorded: StatusEntry | undefined): StatusEntry {
  const kept = new Map((recorded?.exceptions ?? []).map((e) => [e.function, e]));
  const exceptions: StatusException[] = [];
  let status: Status = outcome.refusal === undefined ? "exact" : "pending";
  for (const fn of outcome.functions) {
    if (fn.level === "exact") continue;
    const before = kept.get(fn.path);
    if (fn.level === "opcodes") {
      status = status === "exact" ? "opcodes" : status;
      exceptions.push({ function: fn.path, level: "operands", reason: before?.level === "operands" ? before.reason : PLACEHOLDER });
    } else if (before?.level === "opcodes") {
      status = status === "exact" ? "opcodes" : status;
      exceptions.push(before);
    } else {
      status = "pending";
    }
  }
  return status === "pending" || exceptions.length === 0 ? { status } : { status, exceptions };
}

/** Everything wrong with the record for one fixture; empty when it is exactly right. */
export function problemsFor(outcome: FixtureOutcome, recorded: StatusEntry | undefined): string[] {
  const name = outcome.fixture;
  if (!recorded) return [`${name}: not in bytecode-status.json (run npm run conformance:status)`];
  const actual = describeOutcome(outcome, recorded);
  const problems: string[] = [];
  const where = outcome.refusal === undefined ? "" : ` (${outcome.refusal})`;

  if (actual.status !== recorded.status) {
    const direction = rank(actual.status) > rank(recorded.status) ? "improved" : "regressed";
    problems.push(`${name}: bytecode fidelity ${direction}: recorded ${recorded.status}, now ${actual.status}${where}`);
  }
  if (recorded.status === "pending" && (recorded.exceptions?.length ?? 0) > 0) {
    problems.push(`${name}: a pending fixture cannot carry exceptions`);
  }
  if (recorded.status === "exact" && (recorded.exceptions?.length ?? 0) > 0) {
    problems.push(`${name}: an exact fixture cannot carry exceptions`);
  }

  const wanted = new Map((actual.exceptions ?? []).map((e) => [e.function, e]));
  const have = new Map((recorded.exceptions ?? []).map((e) => [e.function, e]));
  for (const [path, e] of wanted) {
    const mine = have.get(path);
    if (!mine) problems.push(`${name}: ${path} differs from V8 (${e.level}) with no recorded exception`);
    else if (mine.level !== e.level) problems.push(`${name}: ${path} is recorded as an ${mine.level} exception but is now ${e.level}`);
  }
  for (const [path, e] of have) {
    if (!wanted.has(path) && recorded.status !== "pending") problems.push(`${name}: ${path} no longer differs (${e.level}); remove its exception`);
  }
  for (const e of recorded.exceptions ?? []) {
    if (e.reason.trim() === "" || /^todo/i.test(e.reason)) problems.push(`${name}: ${e.function} has no real reason for its ${e.level} exception`);
  }
  return problems;
}

function rank(status: Status): number {
  return status === "exact" ? 2 : status === "opcodes" ? 1 : 0;
}

export function readStatusFile(): StatusFile {
  return existsSync(STATUS_FILE) ? StatusFileSchema.parse(JSON.parse(readFileSync(STATUS_FILE, "utf8"))) : {};
}
