import { FIRST_ITERATION_TIMER_VS_IMMEDIATE, RE_ARMED_LIST_TIE, TIMER_ARMED_AFTER_WRITE } from "@/core/host/nondeterminism";
import type { TaskRef, Tick } from "@/core/timeline/Tick";

type Kind = TaskRef["kind"];
const TIMER_KINDS: ReadonlySet<Kind> = new Set(["timeout", "interval"]);

/** The kinds a rule races and the fewest of them that must be pending for the race to be live. */
type Race = { kinds: ReadonlySet<Kind>; minPending: number; needs?: readonly ReadonlySet<Kind>[] };

const TIMER_VS_IMMEDIATE: Race = { kinds: new Set<Kind>(["timeout", "interval", "immediate"]), minPending: 2, needs: [TIMER_KINDS, new Set<Kind>(["immediate"])] };
const TIMER_VS_TIMER: Race = { kinds: TIMER_KINDS, minPending: 2 };

/**
 * Which pending chips a current warning puts in doubt.
 *
 * This is a heuristic. A `FidelityWarning` is prose and carries no task ids (core/host/nondeterminism.ts),
 * and `Tick.warnings` keeps every warning raised so far for the rest of the run. So a chip is flagged when:
 *  - its label appears in a warning's message, or
 *  - a warning's rule is a race between kinds the chip belongs to, and that race is live: the rule's
 *    kinds are pending in the numbers it needs (timer vs immediate: at least one of each; timer vs timer: at
 *    least two timers). Once an immediate has run, the first rule's race is over and its chips are unflagged.
 * A warning this file does not know races every timer and immediate, needing at least two pending.
 * nextTick and promise jobs are never part of these races. If core ever attaches task ids to warnings,
 * replace this with those ids.
 */
export function ordersAtRisk(timers: Tick["timerQueue"], immediates: Tick["immediateQueue"], warnings: Tick["warnings"]): ReadonlySet<TaskRef["id"]> {
  const flagged = new Set<TaskRef["id"]>();
  const pending = [...timers, ...immediates];
  for (const w of warnings) {
    if (w.kind !== "nondeterminism") continue;
    for (const task of pending) if (w.message.includes(task.label)) flagged.add(task.id);
    const race = raceOf(w.message);
    const racing = pending.filter((t) => race.kinds.has(t.kind));
    const live = racing.length >= race.minPending && (race.needs ?? []).every((group) => racing.some((t) => group.has(t.kind)));
    if (live) for (const task of racing) flagged.add(task.id);
  }
  return flagged;
}

function raceOf(message: string): Race {
  if (message === FIRST_ITERATION_TIMER_VS_IMMEDIATE.warning) return TIMER_VS_IMMEDIATE;
  // The other two rules (a timer re-armed from a timer, a timer armed after output) race timers with timers.
  if (message === RE_ARMED_LIST_TIE.warning || message === TIMER_ARMED_AFTER_WRITE.warning) return TIMER_VS_TIMER;
  return { kinds: new Set<Kind>(["timeout", "interval", "immediate"]), minPending: 2 };
}
