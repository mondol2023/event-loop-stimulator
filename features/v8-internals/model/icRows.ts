import { VERIFIED_SLOT_KINDS } from "@/core/runtime/ic/verifiedSlotKinds";
import type { FeedbackSlotSnapshot, FeedbackSnapshot } from "@/core/timeline/Tick";
import type { MapId } from "@/core/shared/ids";

export type IcRow = {
  functionName: string;
  slot: number;
  kind: string;
  state: FeedbackSlotSnapshot["state"];
  mapIds: readonly MapId[];
  truth: "verified-model" | "modeled";
};

// Capped so a huge program cannot flood the table; `total` tells the learner how many were left off.
export function icRows(feedback: readonly FeedbackSnapshot[], limit = 50): { rows: IcRow[]; total: number } {
  const rows: IcRow[] = [];
  let total = 0;
  for (const fn of feedback) {
    for (const slot of fn.slots) {
      total++;
      if (rows.length >= limit) continue;
      rows.push({
        functionName: fn.functionName,
        slot: slot.index,
        kind: slot.kind,
        state: slot.state,
        mapIds: slot.mapIds,
        truth: VERIFIED_SLOT_KINDS.has(slot.kind) ? "verified-model" : "modeled",
      });
    }
  }
  return { rows, total };
}
