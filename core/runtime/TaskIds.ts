import type { TaskId } from "@/core/shared/ids";
import type { TaskRef } from "@/core/timeline/Command";

/**
 * Hands out the ids of queued work (microtask jobs, nextTick callbacks, timers, immediates) in
 * creation order from 1, one sequence per realm, so a TaskRef names one task whatever queue it
 * sits in. It also keeps the log of every task ever queued, which the timeline reads to narrate
 * what was queued between two ticks (a task can be queued and started with no tick in between).
 */
export class TaskIds {
  #next = 1;
  readonly #log: TaskRef[] = [];

  next(): TaskId {
    const id = this.#next as TaskId;
    this.#next += 1;
    return id;
  }

  /** Notes a task that has just been queued. */
  record(task: TaskRef): void {
    this.#log.push(task);
  }

  /** Every task queued so far, in queueing order. */
  get log(): readonly TaskRef[] {
    return this.#log;
  }
}
