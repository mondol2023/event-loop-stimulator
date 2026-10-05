import { z } from "../../core/shared/zod.ts";
import type { Fixture } from "./fixtures.mts";
import type { RealRun, RealRunOptions } from "./run-real.mts";
import type { Target } from "./target.mts";

// The on-disk shape of `<name>.expected.json`: what real node did with a
// fixture (PROMPT.md §3.4). Written only by `npm run conformance:record` on the
// pinned runtime, and read back by the conformance tests and the integrity test.

const OutcomeSchema = z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number().int() }).strict();

const InstructionSchema = z
  .object({
    offset: z.number().int().nonnegative(),
    position: z.object({ at: z.number().int().nonnegative(), kind: z.enum(["S", "E"]) }).strict().optional(),
    // Mnemonic and operands, addresses stripped, jump targets as "(@51)".
    text: z.string(),
  })
  .strict();

const HeaderSchema = z
  .object({
    length: z.number().int().nonnegative(),
    parameterCount: z.number().int().nonnegative(),
    registerCount: z.number().int().nonnegative(),
    frameSize: z.number().int().nonnegative(),
  })
  .strict();

// Zod 4 recursive object: the getter defers the self-reference.
const RealFunctionBytecodeSchema = z
  .object({
    name: z.string(),
    header: HeaderSchema,
    instructions: z.array(InstructionSchema),
    constantPool: z.array(z.string()),
    handlerTable: z.array(z.string()),
    // Key = constant-pool index of the child's SharedFunctionInfo.
    get children() {
      return z.record(z.string(), RealFunctionBytecodeSchema);
    },
  })
  .strict();

export const ExpectationSchema = z
  .object({
    schema: z.literal(1),
    fixture: z.string().min(1),
    kind: z.enum(["program", "internals"]),
    lang: z.enum(["js", "ts"]),
    target: z.object({ node: z.string().min(1), v8: z.string().min(1) }).strict(),
    nondeterministic: z.boolean(),
    outcomes: z.array(OutcomeSchema).min(1),
    bytecode: RealFunctionBytecodeSchema.optional(),
  })
  .strict()
  .refine((e) => e.nondeterministic || e.outcomes.length === 1, {
    message: "a deterministic fixture records exactly one outcome",
    path: ["outcomes"],
  });

export type RealInstruction = z.infer<typeof InstructionSchema>;
export type RealFunctionBytecode = z.infer<typeof RealFunctionBytecodeSchema>;
export type Expectation = z.infer<typeof ExpectationSchema>;

export function parseExpectation(json: unknown): Expectation {
  return ExpectationSchema.parse(json);
}

/** 2-space JSON with a trailing newline: the exact bytes written to disk. */
export function serializeExpectation(expectation: Expectation): string {
  return `${JSON.stringify(expectation, null, 2)}\n`;
}

export type RunFn = (source: string, opts: RealRunOptions) => RealRun;

/**
 * Seam for Task 4 (bytecode capture): the recorder passes a hook here and this
 * module only decides WHEN it is called. Absent in Task 3.
 */
export type CaptureBytecode = (fixture: Fixture) => RealFunctionBytecode | undefined;

export const DEFAULT_NONDETERMINISTIC_RUNS = 25;

type Outcome = Expectation["outcomes"][number];

function compareOutcomes(a: Outcome, b: Outcome): number {
  if (a.exitCode !== b.exitCode) return a.exitCode < b.exitCode ? -1 : 1;
  if (a.stdout !== b.stdout) return a.stdout < b.stdout ? -1 : 1;
  if (a.stderr !== b.stderr) return a.stderr < b.stderr ? -1 : 1;
  return 0;
}

/** Runs one fixture through real node (via `run`) and builds its expectation. `run` already normalizes. */
export function buildExpectation(
  fixture: Fixture,
  target: Target,
  run: RunFn,
  captureBytecode?: CaptureBytecode,
): Expectation {
  const nondeterministic = fixture.meta.nondeterministic === true;
  const runs = nondeterministic ? (fixture.meta.runs ?? DEFAULT_NONDETERMINISTIC_RUNS) : 1;
  const opts: RealRunOptions =
    fixture.meta.nodeArgs === undefined
      ? { lang: fixture.lang }
      : { lang: fixture.lang, nodeArgs: fixture.meta.nodeArgs };

  const distinct = new Map<string, Outcome>();
  for (let i = 0; i < runs; i++) {
    const r = run(fixture.source, opts);
    const outcome: Outcome = { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
    distinct.set(JSON.stringify([outcome.exitCode, outcome.stdout, outcome.stderr]), outcome);
  }
  const outcomes = [...distinct.values()].sort(compareOutcomes);

  const expectation: Expectation = {
    schema: 1,
    fixture: fixture.name,
    kind: fixture.kind,
    lang: fixture.lang,
    target: { node: target.node, v8: target.v8 },
    nondeterministic,
    outcomes,
  };

  const wantsBytecode =
    fixture.kind === "program" && (fixture.meta.expect === "run" || outcomes.some((o) => o.exitCode === 0));
  if (captureBytecode && wantsBytecode) {
    const bytecode = captureBytecode(fixture);
    if (bytecode !== undefined) expectation.bytecode = bytecode;
  }
  return expectation;
}
