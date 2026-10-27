"use client";

import type { LucideIcon } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import { PLAYBACK_SPEEDS } from "../../store/playgroundStore";

export function TransportButton({
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

export function SpeedGroup() {
  const store = usePlaygroundStore();
  const speed = useStore(store, (s) => s.playback.speed);
  const empty = useStore(store, (s) => s.playback.length === 0);
  return (
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
        if (next !== undefined) store.getState().setSpeed(next);
      }}
    >
      {PLAYBACK_SPEEDS.map((s) => (
        <ToggleGroupItem key={s} value={String(s)} aria-label={`${s}×`}>
          {s}×
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
