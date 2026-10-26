import type { BaselineCode } from "@/core/baseline/Template";
import type { HardwareStep } from "@/core/hardware/traceHardware";
import { DEOPTIMIZE_REASONS, TIERS, type TierTrack } from "@/core/interpreter/tiering/tierTimeline";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { DIAGNOSTIC_CODES } from "@/core/shared/diagnostics";
import { LIMITS } from "@/core/shared/limits";
import { SIMULATION_LIMITS, type SimulationStop } from "@/core/shared/simulationHalt";
import { z } from "@/core/shared/zod";
import type { TimelineMarker } from "@/core/timeline/boundaries";
import type { AsmViewOutput } from "@/core/views/AsmView";
import type { AstViewOutput } from "@/core/views/AstView";
import type { BinaryViewOutput } from "@/core/views/BinaryView";
import type { BytecodeViewOutput } from "@/core/views/BytecodeView";
import type { LineIndex } from "@/core/views/lineIndex";

// The message contract between the main thread and the pipeline worker. Both directions are
// validated with Zod, because a worker message is an untrusted boundary even though both ends are
// ours. The request has no `natives` or `host` field and is `.strict()`, so a message carrying
// either cannot be parsed: the test-only modes (D2, D6) are unreachable from the browser.

/** The most characters of serialized timeline a `simulated` response may carry (PROMPT.md 7.5: 20 MB). */
export const TIMELINE_MAX_CHARS = 20 * 1024 * 1024;

/** Bounds memory only. The core still enforces its own 10,240-byte limit, with its own diagnostic. */
const SOURCE_MAX_CHARS = 65_536;
const FAILED_MESSAGE_MAX_CHARS = 500;

export const PipelineRequestSchema = z
  .object({
    type: z.literal("run"),
    jobId: z.number().int().positive(),
    source: z.string().max(SOURCE_MAX_CHARS),
    lang: z.enum(["js", "ts"]),
  })
  .strict();

export type PipelineRequest = z.infer<typeof PipelineRequestSchema>;

export type ClientViews = {
  readonly ast: AstViewOutput;
  readonly bytecode: BytecodeViewOutput;
  readonly asm: AsmViewOutput;
  readonly binary: BinaryViewOutput;
};

export type PipelineResponse =
  | {
      readonly type: "compiled";
      readonly jobId: number;
      readonly diagnostics: Diagnostic[];
      readonly strippedJs: string | null;
      /** `views`, `lineIndex` and `baselines` are null exactly when there are diagnostics. */
      readonly views: ClientViews | null;
      readonly lineIndex: LineIndex | null;
      readonly baselines: BaselineCode[] | null;
    }
  | {
      readonly type: "simulated";
      readonly jobId: number;
      /** `TimelineStore.serialize()`. */
      readonly timeline: string;
      readonly boundaries: number[];
      readonly markers: TimelineMarker[];
      /** Modeled (D5): empty when no function was tiered. */
      readonly tierTracks: TierTrack[];
      /** Illustrative (D2): one step per tick. */
      readonly hardware: HardwareStep[];
      readonly tickCount: number;
      readonly exitCode: number;
      readonly warnings: string[];
      readonly stop: SimulationStop | null;
    }
  | { readonly type: "failed"; readonly jobId: number; readonly message: string };

const jobId = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

const PositionSchema = z.object({ functionId: nonNegativeInt, bytecodeOffset: z.number().int() }).strict();
const PositionsSchema = z.array(PositionSchema);

// A line is checked for what the client reads on every render (its text and positions); the extra
// per-view fields (depth, range, address, bytes, ...) travel through unchecked.
const LineSchema = z.looseObject({ text: z.string(), positions: PositionsSchema });
const FunctionViewSchema = z.looseObject({
  functionId: nonNegativeInt,
  name: z.string(),
  lines: z.array(LineSchema),
  unavailable: z.string().optional(),
});
const FunctionsViewSchema = z.object({ functions: z.array(FunctionViewSchema) }).strict();

const ViewsSchema = z
  .object({
    ast: z.object({ lines: z.array(LineSchema) }).strict(),
    bytecode: FunctionsViewSchema,
    asm: FunctionsViewSchema,
    binary: FunctionsViewSchema,
  })
  .strict();

const LinesSchema = z.array(PositionsSchema);
const LineIndexSchema = z
  .object({
    source: LinesSchema,
    panes: z.object({ ast: LinesSchema, bytecode: LinesSchema, asm: LinesSchema, binary: LinesSchema }).strict(),
  })
  .strict();

const BaselineSchema = z.looseObject({ instructions: z.array(z.unknown()) });

const RangeSchema = z.object({ start: z.number().int(), end: z.number().int() }).strict();
const DiagnosticSchema = z
  .object({
    code: z.enum(DIAGNOSTIC_CODES),
    message: z.string(),
    range: RangeSchema,
    hint: z.string(),
    docs: z.string().optional(),
  })
  .strict();

const MARKERS_MAX = 10_000; // 5,000 ticks, each with at most one job and one warning marker
const MarkerSchema = z.discriminatedUnion("kind", [
  z.object({ index: nonNegativeInt, kind: z.literal("job"), phase: z.string(), loopPhase: z.string().nullable() }).strict(),
  z.object({ index: nonNegativeInt, kind: z.literal("warning"), message: z.string() }).strict(),
]);

const TICKS_MAX = LIMITS.ticks;
const TIER_TRACKS_MAX = 1000;
const TierSchema = z.enum(TIERS);
const TierTrackSchema = z
  .object({
    functionId: nonNegativeInt,
    functionName: z.string(),
    segments: z.array(z.object({ from: nonNegativeInt, tier: TierSchema }).strict()),
    deopts: z.array(z.object({ index: nonNegativeInt, reason: z.enum(DEOPTIMIZE_REASONS) }).strict()),
  })
  .strict();

const AluOpSchema = z.enum(["add", "sub", "and", "or", "xor", "shl", "sar", "cmp", "test", "inc", "dec", "neg", "imul"]);
const HardwareStepSchema = z
  .object({
    alu: AluOpSchema.nullable(),
    bus: z.object({ kind: z.enum(["fetch", "read", "write"]), region: z.enum(["code", "stack", "young", "old"]) }).strict().nullable(),
    servedBy: z.enum(["l1", "l2", "ram"]).nullable(),
    l1: z.array(nonNegativeInt),
    l2: z.array(nonNegativeInt),
  })
  .strict();

const StopSchema = z.union([
  z.object({ kind: z.literal("limit"), limit: z.enum(SIMULATION_LIMITS) }).strict(),
  z.object({ kind: z.literal("unsupported"), reason: z.string() }).strict(),
]);

export const PipelineResponseSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("compiled"),
      jobId,
      diagnostics: z.array(DiagnosticSchema),
      strippedJs: z.string().nullable(),
      views: ViewsSchema.nullable(),
      lineIndex: LineIndexSchema.nullable(),
      baselines: z.array(BaselineSchema).nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("simulated"),
      jobId,
      timeline: z.string().max(TIMELINE_MAX_CHARS),
      boundaries: z.array(nonNegativeInt),
      markers: z.array(MarkerSchema).max(MARKERS_MAX),
      tierTracks: z.array(TierTrackSchema).max(TIER_TRACKS_MAX),
      hardware: z.array(HardwareStepSchema).max(TICKS_MAX),
      tickCount: nonNegativeInt,
      exitCode: z.number().int(),
      warnings: z.array(z.string()),
      stop: StopSchema.nullable(),
    })
    .strict(),
  z.object({ type: z.literal("failed"), jobId, message: z.string().max(FAILED_MESSAGE_MAX_CHARS) }).strict(),
]);

export function parseRequest(data: unknown): PipelineRequest | null {
  const parsed = PipelineRequestSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseResponse(data: unknown): PipelineResponse | null {
  const parsed = PipelineResponseSchema.safeParse(data);
  // The schema checks the shapes the client depends on; the nested view details are typed by core.
  return parsed.success ? (parsed.data as unknown as PipelineResponse) : null;
}
