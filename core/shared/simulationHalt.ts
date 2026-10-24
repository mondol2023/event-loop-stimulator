// How a run stops early (Decision D3). Thrown by the interpreter and runtime, caught only by
// SimulationEngine. It is not a JS exception: JS errors are `Completion` values.

export const SIMULATION_LIMITS = ["ticks", "callDepth", "heapObjects", "virtualTime", "work", "output", "strings"] as const;

export type SimulationLimit = (typeof SIMULATION_LIMITS)[number];

export type SimulationStop =
  | { readonly kind: "limit"; readonly limit: SimulationLimit }
  | { readonly kind: "unsupported"; readonly reason: string };

export class SimulationHalt extends Error {
  readonly stop: SimulationStop;

  constructor(stop: SimulationStop) {
    super(stop.kind === "limit" ? `simulation limit: ${stop.limit}` : `unsupported: ${stop.reason}`);
    this.name = "SimulationHalt";
    this.stop = stop;
  }
}
