"use client";

import { TriangleAlert } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useRef } from "react";
import { useStore } from "zustand";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TickPhase } from "@/core/timeline/Tick";
import type { TimelineMarker } from "@/core/timeline/boundaries";
import { useLoopPhase } from "../../hooks/useTickSelectors";
import { usePlaygroundStore } from "../../store/PlaygroundContext";

/** Where a tick sits along the track, 0 to 100. A single tick sits at the start. */
const percentOf = (index: number, length: number): number => (length > 1 ? (index / (length - 1)) * 100 : 0);

/** The mark for a job start, colored by phase: violet microtasks, outlined violet nextTicks, amber timers and check, neutral otherwise. */
function jobBarClass(phase: TickPhase): string {
  switch (phase) {
    case "microtask":
      return "bg-microtask";
    case "nextTick":
      return "border border-microtask bg-transparent";
    case "timers":
    case "check":
      return "bg-macrotask";
    default:
      return "bg-muted-foreground";
  }
}

function Marker({ marker, length }: { marker: TimelineMarker; length: number }) {
  const label = marker.kind === "job" ? `Tick ${marker.index + 1}, ${marker.phase}` : marker.message;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          data-marker={marker.kind}
          // The position goes through the CSSOM, never a server-rendered style attribute (D1).
          ref={(el) => {
            if (el) el.style.left = `${percentOf(marker.index, length)}%`;
          }}
          className="absolute top-0 flex h-3 w-3 -translate-x-1/2 items-start justify-center"
        >
          {marker.kind === "job" ? (
            <span aria-hidden="true" className={cn("block h-2.5 w-1 rounded-[1px]", jobBarClass(marker.phase))} />
          ) : (
            <TriangleAlert aria-hidden="true" className="size-3 text-warning" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The timeline track: a slider over every tick, with a mark under it for each job start and each
 * fidelity warning. It handles its own keys (the global shortcuts leave a slider alone, ADR-047).
 */
export function Scrubber() {
  const store = usePlaygroundStore();
  const index = useStore(store, (s) => s.playback.index);
  const length = useStore(store, (s) => s.playback.length);
  const markers = useStore(store, (s) => s.compile.markers);
  const { phase } = useLoopPhase();
  const thumbRef = useRef<HTMLSpanElement>(null);
  const playedRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const empty = length === 0;

  // The thumb moves through the CSSOM, never a server-rendered style attribute (D1). It moves by transform,
  // not by `left`: a layout property would count as a layout shift on every tick of a playing run.
  useLayoutEffect(() => {
    const percent = percentOf(index, length);
    if (thumbRef.current) thumbRef.current.style.transform = `translateX(${percent}%)`;
    // The played part of the track grows from the left by scale, for the same reason.
    if (playedRef.current) playedRef.current.style.transform = `scaleX(${percent / 100})`;
  }, [index, length]);

  function seekToPointer(e: PointerEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    store.getState().seek(Math.round(ratio * (length - 1)));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const s = store.getState();
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        if (e.shiftKey) s.jumpBoundary(-1);
        else s.step(-1);
        break;
      case "ArrowRight":
      case "ArrowUp":
        if (e.shiftKey) s.jumpBoundary(1);
        else s.step(1);
        break;
      case "Home":
        s.seek(0);
        break;
      case "End":
        s.seek(s.playback.length - 1);
        break;
      default:
        return;
    }
    // Handled here: the window-level shortcuts must not move the cursor a second time.
    e.preventDefault();
    e.stopPropagation();
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if (empty || e.button !== 0) return;
    dragging.current = true;
    // jsdom and a few embedded browsers lack pointer capture; dragging still works inside the track.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekToPointer(e);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    if (dragging.current) seekToPointer(e);
  }

  function endDrag(): void {
    dragging.current = false;
  }

  return (
    <TooltipProvider>
      <div className="px-2">
        <div
          role="slider"
          aria-label="Timeline"
          aria-valuemin={0}
          aria-valuemax={Math.max(length - 1, 0)}
          aria-valuenow={index}
          aria-valuetext={empty ? "No ticks" : `Tick ${index + 1}, ${phase ?? "unknown phase"}`}
          aria-disabled={empty}
          tabIndex={empty ? -1 : 0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="relative h-5 cursor-pointer touch-none pointer-coarse:h-11 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:cursor-default aria-disabled:opacity-50"
        >
          <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
            <span ref={playedRef} className="absolute inset-0 origin-left [transform:scaleX(0)] bg-primary/40" />
          </span>
          {/* The clip keeps the moved carrier from widening the page; it reaches 8px past each end (the padding around the
              slider) so the thumb is whole at both ends. It clips sideways only, so the thumb's shadow is whole above and
              below. The carrier is as wide as the track, so a percentage translate is a fraction of the track, and the
              thumb sits on its left edge. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 -inset-x-2 overflow-x-clip">
            <span ref={thumbRef} data-testid="scrubber-thumb" className="absolute inset-y-0 inset-x-2">
              <span className="absolute top-1/2 left-0 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow" />
            </span>
          </span>
        </div>
        {/* A sibling, not a child: the children of a slider are presentational and would hide the marks from assistive technology. */}
        <div className="relative h-3">
          {markers.map((marker, i) => (
            <Marker key={`${marker.index}-${marker.kind}-${i}`} marker={marker} length={length} />
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
