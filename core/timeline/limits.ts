// Where a run's limits and stops are named (Decision D3). `SimulationHalt` is thrown by the
// interpreter, runtime and host and caught only by the simulation entry point (`simulate`, then
// SimulationEngine in Task 19); a halt is not a JS exception, so no RangeError ever reaches the
// program. The definitions sit in core/shared so the layers below the timeline can use them.

import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import type { StepObserver } from "@/core/interpreter/IgnitionInterpreter";
import { LIMITS, SIMULATION_LIMIT_NOTICE } from "@/core/shared/limits";
import { SimulationHalt, type SimulationStop } from "@/core/shared/simulationHalt";
import type { Command } from "./Command";

export { LIMITS, SIMULATION_LIMIT_NOTICE, SimulationHalt };
export type { SimulationLimit, SimulationStop } from "@/core/shared/simulationHalt";

/**
 * Counts ticks and halts the run at the tick limit, so `while (true) {}` stops instead of
 * hanging. A tick is statement-level (the owner's ruling on the D4 gate: recursion-factorial
 * needs 28,491 dispatches): a dispatch at a statement position (the `S>` marks), a `JumpLoop`
 * back edge (so an empty loop body still ticks), the entry of a function, and a microtask job
 * start. Every other dispatch belongs to the statement it sits in. Task 19's TickRecorder takes
 * over the counting and adds the phase, GC and exit ticks.
 */
export class TickLimiter implements StepObserver {
  #ticks = 0;
  readonly #statements: readonly ReadonlySet<number>[];

  constructor(program: BytecodeProgram) {
    this.#statements = program.functions.map(
      (fn) => new Set(fn.positions.entries.filter((e) => e.kind === "statement").map((e) => e.offset)),
    );
  }

  get ticks(): number {
    return this.#ticks;
  }

  onCommand(c: Command): void {
    if (c.kind === "job-end") return;
    if (c.kind === "dispatch") {
      const { functionId, bytecodeOffset } = c.pos;
      const boundary =
        bytecodeOffset === 0 || c.opcode === "JumpLoop" || this.#statements[functionId]?.has(bytecodeOffset) === true;
      if (!boundary) return;
    }
    this.#ticks += 1;
    if (this.#ticks > LIMITS.ticks) throw new SimulationHalt({ kind: "limit", limit: "ticks" });
  }
}

/** The `warnings` line for a stop: the §7.1 notice for a limit, the reason for an unsupported stop. */
export function stopNotice(stop: SimulationStop): string {
  return stop.kind === "limit" ? SIMULATION_LIMIT_NOTICE : `Simulation stopped: ${stop.reason}`;
}
