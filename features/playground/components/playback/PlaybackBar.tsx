"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { lazy, Suspense, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { cn } from "cn";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { LoopPhase, TickPhase } from "@/core/timeline/Tick";
import { useLoopPhase } from "../../hooks/useTickSelectors";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import { NarrationLine } from "./NarrationLine";
import { Scrubber } from "./Scrubber";
import { StopNotice } from "./StopNotice";
import { SpeedGroup, TransportButton } from "./transport";

// ADR-060: Radix Popover loads only once a phone-width bar renders, so first-load JS (ADR-062) does not grow.
const MorePlayback = lazy(() => import("./MorePlayback"));

const COMPACT = "(max-width: 479px)";
function subscribeCompact(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(COMPACT);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const isCompact = (): boolean => typeof window.matchMedia === "function" && window.matchMedia(COMPACT).matches;

/** The current tick's phase, in the words the scrubber's markers and the loop view use. */
function phaseLabel(phase: TickPhase | null, loopPhase: LoopPhase | null): string {
  switch (phase) {
    case null:
      return "no run";
    case "script":
      return "main script";
    case "microtask":
      return "microtasks";
    case "loop-transition":
      return loopPhase ?? "between phases";
    default:
      return phase;
  }
}

function phaseTone(phase: TickPhase | null): string {
  switch (phase) {
    case "nextTick":
    case "microtask":
      return "border-microtask/50 text-microtask";
    case "timers":
    case "check":
      return "border-macrotask/50 text-macrotask";
    default:
      return "border-border text-muted-foreground";
  }
}

/** A fixed width, so a longer phase name never moves the stop notice beside it while playing. */
function PhaseChip() {
  const { phase, loopPhase } = useLoopPhase();
  return (
    <span className={cn("inline-flex h-6 w-32 shrink-0 items-center justify-center rounded-full border px-2 font-mono text-xs", phaseTone(phase))}>
      {/* The ellipsis needs a block box: text-overflow does nothing on a flex container's anonymous text. */}
      <span className="block min-w-0 truncate">
        <span className="sr-only">Phase: </span>
        {phaseLabel(phase, loopPhase)}
      </span>
    </span>
  );
}

/** Owns the per-tick subscription, so the rest of the bar does not re-render on every tick. */
function TickCounter({ length }: { length: number }) {
  const store = usePlaygroundStore();
  const index = useStore(store, (s) => s.playback.index);
  return <span className="text-sm text-muted-foreground tabular-nums">{`Tick ${length === 0 ? 0 : index + 1} / ${length}`}</span>;
}

/** The transport controls, the scrubber and the narration: the region under the run views. */
export function PlaybackBar() {
  const store = usePlaygroundStore();
  const length = useStore(store, (s) => s.playback.length);
  const isPlaying = useStore(store, (s) => s.playback.isPlaying);
  // The server snapshot is the wide bar, so SSR output matches the first client render.
  const compact = useSyncExternalStore(subscribeCompact, isCompact, () => false);
  const stop = useStore(store, (s) => s.compile.stop);
  const empty = length === 0;
  // Actions are stable store functions, so reading them once is safe.
  const actions = store.getState();

  return (
    <section aria-label="Playback" data-tour="playback" className="flex shrink-0 flex-col gap-1 border-t border-border bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <TooltipProvider>
          <div className="flex items-center">
            {compact ? null : <TransportButton label="First tick" keys={["Home"]} Icon={SkipBack} disabled={empty} onClick={() => actions.seek(0)} />}
            <TransportButton label="Previous job" keys={["Shift", "←"]} Icon={ChevronsLeft} disabled={empty} onClick={() => actions.jumpBoundary(-1)} />
            <TransportButton label="Step back" keys={["←"]} Icon={ChevronLeft} disabled={empty} onClick={() => actions.step(-1)} />
            <TransportButton
              label={isPlaying ? "Pause" : "Play"}
              keys={["Space"]}
              Icon={isPlaying ? Pause : Play}
              disabled={empty}
              onClick={() => actions.togglePlay()}
              primary
            />
            <TransportButton label="Step forward" keys={["→"]} Icon={ChevronRight} disabled={empty} onClick={() => actions.step(1)} />
            <TransportButton label="Next job" keys={["Shift", "→"]} Icon={ChevronsRight} disabled={empty} onClick={() => actions.jumpBoundary(1)} />
            {compact ? null : <TransportButton label="Last tick" keys={["End"]} Icon={SkipForward} disabled={empty} onClick={() => actions.seek(length - 1)} />}
            {compact ? (
              <Suspense fallback={<span aria-hidden="true" className="size-8 shrink-0" />}>
                <MorePlayback />
              </Suspense>
            ) : null}
          </div>
        </TooltipProvider>
        {compact ? null : <SpeedGroup />}
        <span className="flex items-center gap-2">
          <TickCounter length={length} />
          <PhaseChip />
        </span>
        <StopNotice stop={stop} />
      </div>
      <Scrubber />
      <NarrationLine />
    </section>
  );
}
