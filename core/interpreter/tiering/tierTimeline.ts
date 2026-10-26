import { asFunctionId, type FunctionId } from "@/core/shared/ids";
import type { Tick } from "@/core/timeline/Tick";
import type { DeoptimizeReason, Tier } from "./TieringModel";

// Modeled (D5): the tiers and deopts are read off the ticks the TieringModel annotated; nothing here decides a tier.

// The runtime lists the protocol validates against; the `satisfies` below fails typecheck when TieringModel gains a member that is missing here.
export const TIERS = ["ignition", "sparkplug", "maglev", "turbofan"] as const satisfies readonly Tier[];
export const DEOPTIMIZE_REASONS = ["kWrongMap", "kNotASmi", "kOverflow", "kLostPrecision", "kMinusZero", "kNotANumber"] as const satisfies readonly DeoptimizeReason[];
type Missing = Exclude<Tier, (typeof TIERS)[number]> | Exclude<DeoptimizeReason, (typeof DEOPTIMIZE_REASONS)[number]>;
const allListed: [Missing] extends [never] ? true : never = true;
void allListed;

/** `from` is the tick index where this tier starts. */
export type TierSegment = { from: number; tier: Tier };
export type TierTrack = { functionId: FunctionId; functionName: string; segments: TierSegment[]; deopts: { index: number; reason: DeoptimizeReason }[] };

/** One track per function the model lists, sorted by the tick it first appears on (then by id); `[]` when no tick has `v8.tiers`. */
export function tierTimeline(ticks: readonly Tick[]): TierTrack[] {
  const tracks = new Map<number, TierTrack>();
  const names = new Map<number, string>();

  ticks.forEach((tick, index) => {
    for (const frame of tick.callStack) if (!names.has(frame.functionId)) names.set(frame.functionId, frame.functionName);
    for (const f of tick.v8.feedback) if (!names.has(f.functionId)) names.set(f.functionId, f.functionName);

    const byFunction = tick.v8.tiers?.byFunction;
    if (byFunction) {
      for (const [key, tier] of Object.entries(byFunction)) {
        const id = Number(key);
        let track = tracks.get(id);
        if (!track) tracks.set(id, (track = { functionId: asFunctionId(id), functionName: "", segments: [], deopts: [] }));
        // A function's tier only changes through a model event, so a repeated tier opens no segment.
        if (track.segments.at(-1)?.tier !== tier) track.segments.push({ from: index, tier });
      }
    }
    for (const event of tick.v8.tierEvents ?? []) {
      if (event.kind === "deopt") tracks.get(event.functionId)?.deopts.push({ index, reason: event.reason });
    }
  });

  // Map insertion order is the first-seen order, and a tick lists its functions by ascending id.
  return [...tracks.values()].map((track) => ({ ...track, functionName: names.get(track.functionId) ?? "(anonymous)" }));
}
