"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play, SkipBack, SkipForward, type LucideIcon } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
}: {
  label: string;
  /** The shortcut, one entry per key cap. */
  keys: readonly string[];
  Icon: LucideIcon;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>
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

/** The transport controls, the scrubber and the narration: the region under the run views. */
export function PlaybackBar() {
  const store = usePlaygroundStore();
  const index = useStore(store, (s) => s.playback.index);
  const length = useStore(store, (s) => s.playback.length);
  const isPlaying = useStore(store, (s) => s.playback.isPlaying);
  const speed = useStore(store, (s) => s.playback.speed);
  const stop = useStore(store, (s) => s.compile.stop);
  const empty = length === 0;
  // Actions are stable store functions, so reading them once is safe.
  const actions = store.getState();

  return (
    <section aria-label="Playback" className="flex shrink-0 flex-col gap-1 border-t border-border bg-panel px-3 py-2">
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
        <span className="text-sm text-muted-foreground tabular-nums">{`Tick ${empty ? 0 : index + 1} / ${length}`}</span>
        <StopNotice stop={stop} />
      </div>
      <Scrubber />
      <NarrationLine />
    </section>
  );
}
