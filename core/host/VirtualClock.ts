import { LIMITS } from "@/core/shared/limits";
import { SimulationHalt } from "@/core/shared/simulationHalt";

// The loop's clock: libuv's cached loop time (uv_now) relative to the environment's timer base,
// which is what getLibuvNow() returns to lib/internal/timers.js. JavaScript execution costs 0
// virtual ms, so the clock moves only when the poll phase waits for the next timer.

/** The longest virtual run (PROMPT.md §7.1): past it the run stops with a limit notice. */
export const VIRTUAL_TIME_LIMIT_MS = LIMITS.virtualTimeMs;

export class VirtualClock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  advanceTo(ms: number): void {
    if (ms < this.#now) throw new Error(`VirtualClock cannot move backwards (${ms} < ${this.#now})`);
    if (ms > VIRTUAL_TIME_LIMIT_MS) throw new SimulationHalt({ kind: "limit", limit: "virtualTime" });
    this.#now = ms;
  }
}
