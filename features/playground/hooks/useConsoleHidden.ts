"use client";

import { useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { modeDefaults } from "@/features/preferences/modes";
import { PreferencesContext } from "@/features/preferences/PreferencesProvider";
import { usePlaygroundStore } from "../store/PlaygroundContext";
import type { PlaygroundStore } from "../store/playgroundStore";

// Which job's output the learner has revealed, per store; the console and the narration share it.
type Reveal = { job: number | null; listeners: Set<() => void> };
const reveals = new WeakMap<PlaygroundStore, Reveal>();

function revealOf(store: PlaygroundStore): Reveal {
  let r = reveals.get(store);
  if (!r) {
    r = { job: null, listeners: new Set() };
    reveals.set(store, r);
  }
  return r;
}

function markRevealed(store: PlaygroundStore, job: number): void {
  const r = revealOf(store);
  if (r.job === job) return;
  r.job = job;
  r.listeners.forEach((l) => l());
}

/** Whether predict-first is hiding this job's output, and how to reveal it. Reaching the last tick reveals it for the rest of the job. */
export function useConsoleHidden(): { hidden: boolean; reveal(): void } {
  const store = usePlaygroundStore();
  const jobId = useStore(store, (s) => s.compile.jobId);
  const atEnd = useStore(store, (s) => s.playback.length > 0 && s.playback.index === s.playback.length - 1);
  // Without a provider (tests, embeds) the console is plain self-study.
  const predictFirst = modeDefaults(useContext(PreferencesContext)?.mode ?? "self-study").predictFirst;
  const subscribe = useCallback(
    (listener: () => void) => {
      const r = revealOf(store);
      r.listeners.add(listener);
      return () => r.listeners.delete(listener);
    },
    [store],
  );
  const revealedJob = useSyncExternalStore(
    subscribe,
    () => revealOf(store).job,
    () => null,
  );
  useEffect(() => {
    if (atEnd) markRevealed(store, jobId);
  }, [atEnd, store, jobId]);
  return { hidden: predictFirst && revealedJob !== jobId && !atEnd, reveal: () => markRevealed(store, jobId) };
}
