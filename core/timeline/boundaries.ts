import type { LoopPhase, Tick, TickPhase } from "./Tick";

/** Indices where a new job starts: tick 0, and every tick whose `phase` or `loopPhase` differs from the previous tick's. */
export function jobBoundaries(ticks: readonly Tick[]): number[] {
  const out: number[] = [];
  ticks.forEach((t, i) => {
    const prev = ticks[i - 1];
    if (i === 0 || (prev && (prev.phase !== t.phase || prev.loopPhase !== t.loopPhase))) out.push(i);
  });
  return out;
}

export type TimelineMarker =
  | { index: number; kind: "job"; phase: TickPhase; loopPhase: LoopPhase | null }
  | { index: number; kind: "warning"; message: string };

/** Job starts, plus each tick where a warning message appears that the previous tick did not have. Sorted by index; a job marker precedes a warning marker at the same index. */
export function timelineMarkers(ticks: readonly Tick[]): TimelineMarker[] {
  const out: TimelineMarker[] = [];
  const boundaries = new Set(jobBoundaries(ticks));
  ticks.forEach((t, i) => {
    if (boundaries.has(i)) out.push({ index: i, kind: "job", phase: t.phase, loopPhase: t.loopPhase });
    const before = new Set((ticks[i - 1]?.warnings ?? []).map((w) => w.message));
    const seen = new Set<string>();
    for (const w of t.warnings) {
      if (before.has(w.message) || seen.has(w.message)) continue;
      seen.add(w.message);
      out.push({ index: i, kind: "warning", message: w.message });
    }
  });
  return out;
}
