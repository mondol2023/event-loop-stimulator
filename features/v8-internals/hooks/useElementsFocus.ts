"use client";

import { useMemo } from "react";
import { useStore } from "zustand";
import type { ElementsKind } from "@/core/runtime/objects/ElementsKind";
import { usePlaygroundStore } from "@/features/playground/store/PlaygroundContext";
import { getTimeline } from "@/features/playground/store/timelineHolder";
import { latestChangedElements } from "../model/elementsFocus";

/** The object whose elements kind changed most recently at or before the current tick (the lattice shows that one). */
export function useElementsFocus(): { objectId: number; kind: ElementsKind } | null {
  const store = usePlaygroundStore();
  const index = useStore(store, (s) => (s.playback.length > 0 ? s.playback.index : -1));
  const version = useStore(store, (s) => s.compile.timelineVersion);
  return useMemo(() => {
    // `version` is the timeline's identity (the holder is not reactive), so a new timeline recomputes.
    void version;
    const timeline = getTimeline(store);
    return timeline && index >= 0 ? latestChangedElements((i) => timeline.at(i), index) : null;
  }, [store, index, version]);
}
