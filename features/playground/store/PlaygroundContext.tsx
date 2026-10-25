"use client";

import { createContext, useContext } from "react";
import type { PlaygroundStore } from "./playgroundStore";

// One store per playground, passed by context so tests and multiple playgrounds never share state.

export const PlaygroundStoreContext = createContext<PlaygroundStore | null>(null);

/** Throws outside a provider: a missing provider is a programmer error, not a state to render. */
export function usePlaygroundStore(): PlaygroundStore {
  const store = useContext(PlaygroundStoreContext);
  if (!store) throw new Error("usePlaygroundStore must be used inside a PlaygroundStoreContext provider.");
  return store;
}

// Compiles the pending edit now instead of after the debounce; a no-op until the pipeline client has loaded.
export const RunNowContext = createContext<() => void>(() => {});

export function useRunNow(): () => void {
  return useContext(RunNowContext);
}
