import { SimulationHalt } from "@/core/shared/simulationHalt";

// The `work` limit (Decision D3): every element a builtin visits is one unit, so a `map` over
// `length = 2**32 - 1` stops with the "real Node would continue" notice instead of spinning.

export const WORK_LIMIT = 1_000_000;

export class WorkBudget {
  #used = 0;

  /** Charges `units` of work; past the limit the run halts (never a JS RangeError). */
  charge(units = 1): void {
    this.#used += units;
    if (this.#used > WORK_LIMIT) throw new SimulationHalt({ kind: "limit", limit: "work" });
  }

  get used(): number {
    return this.#used;
  }
}
