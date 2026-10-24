import type { Tick } from "./Tick";

/** Indices where a new job starts: tick 0, and every tick whose `phase` or `loopPhase` differs from the previous tick's. */
export function jobBoundaries(ticks: readonly Tick[]): number[] {
  const out: number[] = [];
  ticks.forEach((t, i) => {
    const prev = ticks[i - 1];
    if (i === 0 || (prev && (prev.phase !== t.phase || prev.loopPhase !== t.loopPhase))) out.push(i);
  });
  return out;
}
