"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play, SkipBack, SkipForward, type LucideIcon } from "lucide-react";
import { useStore } from "zustand";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { LoopPhase, TickPhase } from "@/core/timeline/Tick";
import { useLoopPhase } from "../../hooks/useTickSelectors";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import { PLAYBACK_SPEEDS } from "../../store/playgroundStore";
import { NarrationLine } from "./NarrationLine";
import { Scrubber } from "./Scrubber";
import { StopNotice } from "./StopNotice";

function TransportButton({
  label,
  keys,
  Icon,
  disabled,
  onClick,
  primary = false,
}: {
  label: string;
  /** The shortcut, one entry per key cap. */
  keys: readonly string[];
  Icon: LucideIcon;
  disabled: boolean;
  onClick: () => void;
  /** Play/Pause: the one primary (green) control, since green marks what runs. */
  primary?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant={primary ? "default" : "ghost"} size="icon" aria-label={label} disabled={disabled} onClick={onClick}>
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <KbdGroup>
          {keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  );
}

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
  const speed = useStore(store, (s) => s.playback.speed);
  const stop = useStore(store, (s) => s.compile.stop);
  const empty = length === 0;
  // Actions are stable store functions, so reading them once is safe.
  const actions = store.getState();

  return (
    <section aria-label="Playback" data-tour="playback" className="flex shrink-0 flex-col gap-1 border-t border-border bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <TooltipProvider>
          <div className="flex items-center">
            <TransportButton label="First tick" keys={["Home"]} Icon={SkipBack} disabled={empty} onClick={() => actions.seek(0)} />
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
            <TransportButton label="Last tick" keys={["End"]} Icon={SkipForward} disabled={empty} onClick={() => actions.seek(length - 1)} />
          </div>
        </TooltipProvider>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Playback speed"
          disabled={empty}
          value={String(speed)}
          onValueChange={(v) => {
            // Pressing the active speed reports an empty value; a speed is always selected.
            const next = PLAYBACK_SPEEDS.find((s) => String(s) === v);
            if (next !== undefined) actions.setSpeed(next);
          }}
        >
          {PLAYBACK_SPEEDS.map((s) => (
            <ToggleGroupItem key={s} value={String(s)} aria-label={`${s}×`}>
              {s}×
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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
