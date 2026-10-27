"use client";

import { Ellipsis, SkipBack, SkipForward } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import { SpeedGroup, TransportButton } from "./transport";

/** ADR-060: at phone width First, Last and speed leave the bar for this popover; its chunk loads with the first compact render. */
export default function MorePlayback() {
  const store = usePlaygroundStore();
  const length = useStore(store, (s) => s.playback.length);
  const empty = length === 0;
  const actions = store.getState();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="More playback">
          <Ellipsis aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="More playback">
        <TooltipProvider>
          <div className="flex items-center gap-1">
            <TransportButton label="First tick" keys={["Home"]} Icon={SkipBack} disabled={empty} onClick={() => actions.seek(0)} />
            <TransportButton label="Last tick" keys={["End"]} Icon={SkipForward} disabled={empty} onClick={() => actions.seek(length - 1)} />
          </div>
        </TooltipProvider>
        <SpeedGroup />
      </PopoverContent>
    </Popover>
  );
}
