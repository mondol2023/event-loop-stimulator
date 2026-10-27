"use client";

import { useMemo, useState } from "react";
import { useStore } from "zustand";
import { usePlaygroundStore } from "@/features/playground/store/PlaygroundContext";
import { getTimeline } from "@/features/playground/store/timelineHolder";
import { ElementsFocusTracker, type ElementsFocus } from "../model/elementsFocus";

/** The object whose elements kind changed most recently at or before the current tick (the lattice shows that one). */
export function useElementsFocus(): ElementsFocus | null {
  const store = usePlaygroundStore();
  const index = useStore(store, (s) => (s.playback.length > 0 ? s.playback.index : -1));
  const version = useStore(store, (s) => s.compile.timelineVersion);
  // The tracker is keyed by the timeline object, so a new run starts over; resolving the same index twice is free.
  const [tracker] = useState(() => new ElementsFocusTracker());
  return useMemo(() => {
    // `version` is the timeline's identity (the holder is not reactive), so a new timeline recomputes.
    void version;
    const timeline = getTimeline(store);
    return timeline && index >= 0 ? tracker.resolve(timeline, (i) => timeline.at(i), index) : null;
  }, [store, tracker, index, version]);
}
