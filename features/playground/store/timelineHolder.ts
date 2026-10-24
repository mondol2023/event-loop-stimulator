import type { TimelineStore } from "@/core/timeline/TimelineStore";

// The TimelineStore lives beside the Zustand state, not in it (D7): it is a large class instance
// with private fields and an LRU cache, and Zustand state must stay plain, comparable data.
// Components read it through the store's `timelineVersion`, which changes whenever it is replaced.

const holders = new WeakMap<object, TimelineStore>();

export function getTimeline(store: object): TimelineStore | null {
  return holders.get(store) ?? null;
}

export function setTimeline(store: object, timeline: TimelineStore | null): void {
  if (timeline) holders.set(store, timeline);
  else holders.delete(store);
}
