import type { Opcode } from "@/core/bytecode/bytecodes";
import type { IcState } from "@/core/runtime/ic/FeedbackVector";
import type { TruthLevel } from "@/core/shared/fidelity";
import type { FunctionId, MapId } from "@/core/shared/ids";

// V8's TieringManager (src/execution/tiering-manager.cc), as a Modeled observer of the Exact interpreter (D5).
//
// Design note.
// - The interpreter holds only `TieringHooks`. Every hook is fire-and-forget: it returns void, never throws,
//   and takes a plain-data site that carries no heap reference, so nothing can flow back into a run.
// - The timeline holds only `TieringReadout`: it reads the tiers and drains the events onto the tick where they
//   happen (D2). Tier changes are never ticks, and the interpreter never reads the model.
// - Budgets are in bytecode bytes, as V8's interrupt budget is (`invocation count × bytecode length`).
//   An invocation charges the function's length; a back edge charges its loop's length.
//   Each budget is re-armed for the next tier when the previous one fires, so the thresholds add up.
// - An IC change re-arms the optimization budget to at least `minimum_invocations_after_ic_update` invocations.
//   In optimized code it deopts with `kWrongMap`. A binary-op hint that widens deopts with
//   `kNotASmi`, `kOverflow` or `kNotANumber`.
// - Every output value carries `truth: "modeled"`: V8's heuristics, not a recording of them.
// - Proof of isolation: the conformance suite gives identical results with the model on (D5).

/** The tier a function's code runs in (`CodeKind`: INTERPRETED_FUNCTION, BASELINE, MAGLEV, TURBOFAN_JS). */
export type Tier = "ignition" | "sparkplug" | "maglev" | "turbofan";

/** The only truth level a tiering output may claim. */
export type ModeledTruth = Extract<TruthLevel, "modeled">;
export const TIERING_TRUTH: ModeledTruth = "modeled";

// Defaults at V8 13.6.233.17, src/flags/flag-definitions.h; keys are the `v8_flags` names (non-Android build).
export const TIERING_FLAGS = {
  invocation_count_for_feedback_allocation: 8,
  invocation_count_for_maglev: 400,
  invocation_count_for_turbofan: 3000,
  invocation_count_for_osr: 500,
  invocation_count_for_maglev_osr: 100,
  minimum_invocations_after_ic_update: 500,
  minimum_invocations_before_optimization: 2,
} as const satisfies Readonly<Record<string, number>>;

// Sparkplug follows feedback allocation directly; `baseline_batch_compilation_threshold` (4 KB) batching is not modeled.
export const SPARKPLUG_AFTER: keyof typeof TIERING_FLAGS = "invocation_count_for_feedback_allocation";

/** The `DeoptimizeReason` values the model raises (src/deoptimizer/deoptimize-reason.h). */
export type DeoptimizeReason = "kWrongMap" | "kNotASmi" | "kOverflow" | "kNotANumber";

/** `DeoptimizeReasonToString`, verbatim from the same header, for the narration. */
export const DEOPTIMIZE_REASON_MESSAGES: Readonly<Record<DeoptimizeReason, string>> = {
  kWrongMap: "wrong map",
  kNotASmi: "not a Smi",
  kOverflow: "overflow",
  kNotANumber: "not a Number",
};

/** The `BinaryOperationHint` values the model keeps (src/objects/type-hints.h); the hint lives only in the model. */
export type BinaryOperationHint = "kNone" | "kSignedSmall" | "kNumber" | "kAny";

/** The hint lattice, narrowest first: a hint only ever widens. */
export const BINARY_OPERATION_HINT_ORDER = ["kNone", "kSignedSmall", "kNumber", "kAny"] as const satisfies readonly BinaryOperationHint[];

/** The opcodes that collect binary-op feedback here (V8's unary Inc/Dec/Negate/BitwiseNot share the hint but are not hooked). */
export type BinaryOpcode = Extract<
  Opcode,
  | "Add"
  | "Sub"
  | "Mul"
  | "Div"
  | "Mod"
  | "Exp"
  | "BitwiseOr"
  | "BitwiseXor"
  | "BitwiseAnd"
  | "ShiftLeft"
  | "ShiftRight"
  | "ShiftRightLogical"
  | "AddSmi"
  | "SubSmi"
  | "MulSmi"
  | "DivSmi"
  | "ModSmi"
  | "ExpSmi"
  | "BitwiseOrSmi"
  | "BitwiseXorSmi"
  | "BitwiseAndSmi"
  | "ShiftLeftSmi"
  | "ShiftRightSmi"
  | "ShiftRightLogicalSmi"
>;

/** A Number operand or result is copied as its value; anything else is "other", so no heap reference reaches the model. */
export type OperandSample = number | "other";

/** Function entry through Call or Construct; a generator resume is not one (it bypasses the entry trampoline). */
export type InvokeSite = {
  readonly functionId: FunctionId;
  /** `BytecodeArray::length`, the unit of the interrupt budget. */
  readonly bytecodeLength: number;
};

/** A `JumpLoop` that is taken. */
export type BackEdgeSite = {
  readonly functionId: FunctionId;
  readonly bytecodeLength: number;
  /** Offset of the JumpLoop itself. */
  readonly bytecodeOffset: number;
  /** Offset of the loop header it jumps to; `bytecodeOffset - loopHeaderOffset` is the budget it charges. */
  readonly loopHeaderOffset: number;
};

/** A property IC whose feedback changed: a new receiver Map was recorded or the state moved (`OnFeedbackChanged`). */
export type IcTransitionSite = {
  readonly functionId: FunctionId;
  readonly bytecodeOffset: number;
  readonly slot: number;
  readonly from: IcState;
  readonly to: IcState;
  /** The receiver Map that caused the change. */
  readonly mapId: MapId;
  /** Maps the slot holds afterwards; 0 once megamorphic. */
  readonly mapCount: number;
};

/** One binary operation that completed normally (a throw leaves the hint as it was). */
export type BinaryOpSite = {
  readonly functionId: FunctionId;
  readonly bytecodeOffset: number;
  readonly opcode: BinaryOpcode;
  readonly left: OperandSample;
  /** The Smi immediate for the `*Smi` forms. */
  readonly right: OperandSample;
  readonly result: OperandSample;
};

/** What the interpreter may call. Write-only: every hook returns void and must not throw. */
export interface TieringHooks {
  onInvoke(site: InvokeSite): void;
  onBackEdge(site: BackEdgeSite): void;
  onIcTransition(site: IcTransitionSite): void;
  onBinaryOp(site: BinaryOpSite): void;
}

export type TierUpEvent = {
  readonly kind: "tier-up";
  readonly truth: ModeledTruth;
  readonly functionId: FunctionId;
  readonly from: Exclude<Tier, "turbofan">;
  readonly to: Exclude<Tier, "ignition">;
  /** On-stack replacement from a back edge, rather than a tier-up at the next call. */
  readonly osr: boolean;
};

export type DeoptEvent = {
  readonly kind: "deopt";
  readonly truth: ModeledTruth;
  readonly functionId: FunctionId;
  /** Only optimized code speculates, so only it deopts. */
  readonly from: Extract<Tier, "maglev" | "turbofan">;
  /** Back to baseline code when the function has it, as `SharedFunctionInfo::GetCode` returns it. */
  readonly to: Extract<Tier, "ignition" | "sparkplug">;
  readonly reason: DeoptimizeReason;
  /** Where the speculation broke. */
  readonly bytecodeOffset: number;
};

export type TierEvent = TierUpEvent | DeoptEvent;

/** The tiers on one tick: a function is listed from its first invocation. */
export type ModeledTiers = {
  readonly truth: ModeledTruth;
  readonly byFunction: Readonly<Record<FunctionId, Tier>>;
};

/** What the timeline reads, and only the timeline. */
export interface TieringReadout {
  tiers(): ModeledTiers;
  /** The events since the last drain, oldest first. */
  drainEvents(): readonly TierEvent[];
}

/** Hooks that observe nothing: the interpreter's default when no model is attached. */
export const NO_TIERING: TieringHooks = {
  onInvoke: () => undefined,
  onBackEdge: () => undefined,
  onIcTransition: () => undefined,
  onBinaryOp: () => undefined,
};
