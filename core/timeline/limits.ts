// Where a run's limits and stops are named (Decision D3). `SimulationHalt` is thrown by the
// interpreter, runtime and host and caught only by the simulation entry point (`simulate`, then
// SimulationEngine in Task 19); a halt is not a JS exception, so no RangeError ever reaches the
// program. The definitions sit in core/shared so the layers below the timeline can use them.

import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import type { StepObserver } from "@/core/interpreter/IgnitionInterpreter";
import { LIMITS, SIMULATION_LIMIT_NOTICE } from "@/core/shared/limits";
import { SimulationHalt, type SimulationStop } from "@/core/shared/simulationHalt";
import type { Command } from "./Command";
import { TickBoundary } from "./tickBoundary";

export { LIMITS, SIMULATION_LIMIT_NOTICE, SimulationHalt };
export type { SimulationLimit, SimulationStop } from "@/core/shared/simulationHalt";

/**
 * Counts ticks and halts the run at the tick limit, so `while (true) {}` stops instead of
 * hanging. It is the observer of a run that records nothing; the TickRecorder counts the same
 * ticks (see TickBoundary), so a run stops at the same place whether or not it is recorded.
 */
export class TickLimiter implements StepObserver {
  #ticks = 0;
  readonly #boundary: TickBoundary;

  constructor(program: BytecodeProgram) {
    this.#boundary = new TickBoundary(program);
  }

  get ticks(): number {
    return this.#ticks;
  }

  onCommand(c: Command): void {
    if (!this.#boundary.isTick(c)) return;
    if (this.#ticks >= LIMITS.ticks) throw new SimulationHalt({ kind: "limit", limit: "ticks" });
    this.#ticks += 1;
  }
}

/** The `warnings` line for a stop: the §7.1 notice for a limit, the reason for an unsupported stop. */
export function stopNotice(stop: SimulationStop): string {
  return stop.kind === "limit" ? SIMULATION_LIMIT_NOTICE : `Simulation stopped: ${stop.reason}`;
}
