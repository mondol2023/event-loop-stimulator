import type { Opcode } from "@/core/bytecode/bytecodes";
import type { IcState } from "@/core/runtime/ic/FeedbackVector";
import { isSmi } from "@/core/runtime/values/Smi";
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

type FunctionState = {
  tier: Tier;
  /** Sparkplug code exists, so a deopt lands there rather than in Ignition. */
  hasBaseline: boolean;
  /** The latest `BytecodeArray::length` seen for the function. */
  length: number;
  invocations: number;
  /** Bytes charged to the interrupt budget by invocations and back edges since the first call. */
  profile: number;
  /** Bytes charged by back edges alone: the on-stack-replacement counter. */
  loopBytes: number;
  /** Optimization waits until `profile` reaches this (`minimum_invocations_after_ic_update`). */
  gate: number;
};

const FLAGS = TIERING_FLAGS;
const HINT_RANK: Readonly<Record<BinaryOperationHint, number>> = { kNone: 0, kSignedSmall: 1, kNumber: 2, kAny: 3 };

function isOptimized(tier: Tier): tier is "maglev" | "turbofan" {
  return tier === "maglev" || tier === "turbofan";
}

/** The hint one completed operation gives (BinaryOpFeedback): Smi operands and result are SignedSmall, other Numbers Number, anything else Any. */
function hintOf(site: BinaryOpSite): BinaryOperationHint {
  const { left, right, result } = site;
  if (typeof left !== "number" || typeof right !== "number" || typeof result !== "number") return "kAny";
  return isSmi(left) && isSmi(right) && isSmi(result) ? "kSignedSmall" : "kNumber";
}

/** Why optimized code would give up on a widened hint: a non-Number operand, a non-Smi operand, or a Smi operation that left the Smi range. */
function deoptReasonFor(widenedTo: BinaryOperationHint, site: BinaryOpSite): DeoptimizeReason {
  if (widenedTo === "kAny") return "kNotANumber";
  const smiOperands = typeof site.left === "number" && typeof site.right === "number" && isSmi(site.left) && isSmi(site.right);
  return smiOperands ? "kOverflow" : "kNotASmi";
}

export class TieringModel implements TieringHooks, TieringReadout {
  readonly #functions = new Map<FunctionId, FunctionState>();
  readonly #hints = new Map<FunctionId, Map<number, BinaryOperationHint>>();
  #events: TierEvent[] = [];

  onInvoke(site: InvokeSite): void {
    const state = this.#state(site.functionId, site.bytecodeLength);
    state.invocations += 1;
    state.profile += state.length;
    this.#tierUpByBudget(site.functionId, state, false);
  }

  onBackEdge(site: BackEdgeSite): void {
    const state = this.#state(site.functionId, site.bytecodeLength);
    const charge = Math.max(site.bytecodeOffset - site.loopHeaderOffset, 0);
    state.profile += charge;
    state.loopBytes += charge;
    if (state.tier === "ignition") {
      this.#tierUpByBudget(site.functionId, state, true);
      return;
    }
    if (state.profile < state.gate) return;
    if (state.tier === "sparkplug" && state.loopBytes >= FLAGS.invocation_count_for_maglev_osr * state.length) {
      this.#tierUp(site.functionId, state, "sparkplug", "maglev", true);
    } else if (state.tier === "maglev" && state.loopBytes >= FLAGS.invocation_count_for_osr * state.length) {
      this.#tierUp(site.functionId, state, "maglev", "turbofan", true);
    }
  }

  onIcTransition(site: IcTransitionSite): void {
    const state = this.#state(site.functionId, 0);
    // A site that never had feedback has nothing for optimized code to be wrong about.
    if (site.from !== "UNINITIALIZED") this.#deopt(site.functionId, state, "kWrongMap", site.bytecodeOffset);
    this.#rearm(state);
  }

  onBinaryOp(site: BinaryOpSite): void {
    const state = this.#state(site.functionId, 0);
    let hints = this.#hints.get(site.functionId);
    if (!hints) this.#hints.set(site.functionId, (hints = new Map()));
    const before = hints.get(site.bytecodeOffset) ?? "kNone";
    const seen = hintOf(site);
    if (HINT_RANK[seen] <= HINT_RANK[before]) return;
    hints.set(site.bytecodeOffset, seen);
    // The first hint is new feedback, not a broken speculation; V8 does not re-arm the budget for binary-op feedback.
    if (before !== "kNone") this.#deopt(site.functionId, state, deoptReasonFor(seen, site), site.bytecodeOffset);
  }

  tiers(): ModeledTiers {
    const byFunction: Record<FunctionId, Tier> = {};
    for (const [id, state] of this.#functions) byFunction[id] = state.tier;
    return { truth: TIERING_TRUTH, byFunction };
  }

  drainEvents(): readonly TierEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  #state(id: FunctionId, length: number): FunctionState {
    let state = this.#functions.get(id);
    if (!state) {
      state = { tier: "ignition", hasBaseline: false, length: 1, invocations: 0, profile: 0, loopBytes: 0, gate: 0 };
      this.#functions.set(id, state);
    }
    if (length > 0) state.length = length;
    return state;
  }

  /** `TieringManager::OnInterruptTick`: the next tier is due once the budget the earlier tiers add up to is spent. */
  #tierUpByBudget(id: FunctionId, state: FunctionState, osr: boolean): void {
    const { length, profile } = state;
    switch (state.tier) {
      case "ignition":
        if (profile >= FLAGS[SPARKPLUG_AFTER] * length) this.#tierUp(id, state, "ignition", "sparkplug", osr);
        return;
      case "sparkplug":
        if (profile >= Math.max(FLAGS.invocation_count_for_maglev * length, state.gate) && state.invocations >= FLAGS.minimum_invocations_before_optimization) {
          this.#tierUp(id, state, "sparkplug", "maglev", false);
        }
        return;
      case "maglev":
        if (profile >= Math.max(FLAGS.invocation_count_for_turbofan * length, state.gate)) this.#tierUp(id, state, "maglev", "turbofan", false);
        return;
      case "turbofan":
        return;
    }
  }

  #tierUp(id: FunctionId, state: FunctionState, from: Exclude<Tier, "turbofan">, to: Exclude<Tier, "ignition">, osr: boolean): void {
    state.tier = to;
    if (to === "sparkplug") state.hasBaseline = true;
    this.#events.push({ kind: "tier-up", truth: TIERING_TRUTH, functionId: id, from, to, osr });
  }

  /** Optimized code gives up its speculation and the function falls back to baseline code. */
  #deopt(id: FunctionId, state: FunctionState, reason: DeoptimizeReason, bytecodeOffset: number): void {
    const from = state.tier;
    if (!isOptimized(from)) return;
    state.tier = state.hasBaseline ? "sparkplug" : "ignition";
    this.#events.push({ kind: "deopt", truth: TIERING_TRUTH, functionId: id, from, to: state.tier, reason, bytecodeOffset });
    this.#rearm(state);
  }

  /** `TieringManager::NotifyICChanged`: raise the remaining budget to at least `minimum_invocations_after_ic_update` invocations. */
  #rearm(state: FunctionState): void {
    state.gate = Math.max(state.gate, state.profile + FLAGS.minimum_invocations_after_ic_update * state.length);
  }
}
