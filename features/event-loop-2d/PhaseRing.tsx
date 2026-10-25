"use client";

import { RefreshCw } from "lucide-react";
import { cn } from "cn";
import type { LoopPhase, TickPhase } from "@/core/timeline/Tick";
import { useLoopPhase } from "@/features/playground/hooks/useTickSelectors";

const PHASES: readonly LoopPhase[] = ["timers", "pending", "poll", "check", "close"];

/** What Node is doing right now, in words: between libuv's phases it is the main script or a drain. */
function doingWhat(phase: TickPhase | null, loopPhase: LoopPhase | null): string {
  switch (phase) {
    case null:
      return "waiting for a run";
    case "script":
      return "running the main script";
    case "nextTick":
    case "microtask":
      return "draining nextTicks/microtasks";
    case "timers":
      return "running timer callbacks";
    case "check":
      return "running setImmediate callbacks";
    case "loop-transition":
      return loopPhase ? `entering the ${loopPhase} phase` : "moving between phases";
    case "gc":
      return "collecting garbage";
    case "exit":
      return "the process is exiting";
  }
}

/** libuv's loop: timers, pending, poll, check, close. The current phase is highlighted and marked `aria-current="step"`. */
export function PhaseRing() {
  const { phase, loopPhase } = useLoopPhase();
  return (
    <div className="flex flex-col gap-2">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Loop phase
      </h4>
      <ol aria-label="Event loop phases" className="flex flex-wrap items-center gap-1.5">
        {PHASES.map((p, i) => {
          const current = p === loopPhase;
          return (
            <li
              key={p}
              aria-current={current ? "step" : undefined}
              className={cn(
                "rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors duration-150",
                current ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
                i < PHASES.length - 1 && "after:ml-2 after:text-muted-foreground after:content-['→']",
              )}
            >
              {p}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted-foreground">{doingWhat(phase, loopPhase)}</p>
    </div>
  );
}
