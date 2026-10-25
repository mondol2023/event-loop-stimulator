"use client";

import { TriangleAlert } from "lucide-react";
import type { SimulationStop } from "@/core/shared/simulationHalt";

/**
 * Shown when the simulator stopped early. It is the simulator's limit, not an error in the program,
 * so it is styled as a warning and never as a JS exception.
 */
export function StopNotice({ stop }: { stop: SimulationStop | null }) {
  if (!stop) return null;
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm text-warning">
      <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
      <span>Simulation limit reached — real Node would continue</span>
      <span className="font-mono text-xs">{stop.kind === "limit" ? stop.limit : stop.reason}</span>
    </p>
  );
}
