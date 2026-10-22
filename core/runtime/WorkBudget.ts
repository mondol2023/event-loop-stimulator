import { LIMITS } from "@/core/shared/limits";
import { SimulationHalt } from "@/core/shared/simulationHalt";

// The `work` limit (Decision D3): every element a builtin visits is one unit, so a `map` over
// `length = 2**32 - 1` stops with the "real Node would continue" notice instead of spinning.

export const WORK_LIMIT = LIMITS.work;

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

/**
 * The `strings` limit: every string the program builds by concatenation or `join` charges its
 * length, so no run can make the host hold more than LIMITS.stringChars characters of them.
 */
export class StringBudget {
  #used = 0;

  charge(length: number): void {
    this.#used += length;
    if (this.#used > LIMITS.stringChars) throw new SimulationHalt({ kind: "limit", limit: "strings" });
  }
}
