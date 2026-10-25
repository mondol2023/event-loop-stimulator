import type { TaskRef, Tick } from "@/core/timeline/Tick";

const TIMER_KINDS: ReadonlySet<TaskRef["kind"]> = new Set(["timeout", "interval", "immediate"]);

/**
 * Whether a task's place in the run is one the current warnings call unreliable in real Node.
 *
 * The warnings (core/host/nondeterminism.ts) describe a race between timers and immediates in
 * prose and name no task, so a chip is flagged when its label appears in the message, or when it is a
 * timer or an immediate while a nondeterminism warning is current. nextTick and promise jobs are
 * never part of those races.
 */
export function isOrderAtRisk(task: Pick<TaskRef, "kind" | "label">, warnings: Tick["warnings"]): boolean {
  let any = false;
  for (const w of warnings) {
    if (w.kind !== "nondeterminism") continue;
    any = true;
    if (w.message.includes(task.label)) return true;
  }
  return any && TIMER_KINDS.has(task.kind);
}
