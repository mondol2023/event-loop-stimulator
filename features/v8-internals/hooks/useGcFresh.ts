"use client";

import { useStore } from "zustand";
import type { GcEvent } from "@/core/timeline/Tick";
import { usePlaygroundStore } from "@/features/playground/store/PlaygroundContext";
import { getTimeline } from "@/features/playground/store/timelineHolder";

const gcKey = (gc: GcEvent | undefined): string => (gc ? `${gc.type}:${gc.fromSpace}:${gc.toSpace}:${gc.freedObjects}:${gc.survivedObjects}:${gc.promotedObjects}` : "");

/** True on a tick whose `lastGc` differs from the previous tick's: the tick the collection happened on, which is when the cells move. */
export function useGcFresh(): boolean {
  const store = usePlaygroundStore();
  const index = useStore(store, (s) => (s.playback.length > 0 ? s.playback.index : -1));
  // The holder is not reactive, so a new timeline is told apart by its version.
  const version = useStore(store, (s) => s.compile.timelineVersion);
  void version;
  const timeline = getTimeline(store);
  if (!timeline || index <= 0) return false;
  return gcKey(timeline.at(index).v8.heap.lastGc) !== gcKey(timeline.at(index - 1).v8.heap.lastGc);
}
