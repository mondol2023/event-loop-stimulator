"use client";

import { useEffect, useRef } from "react";
import { usePlaygroundStore } from "@/features/playground/store/PlaygroundContext";
import { modeDefaults } from "./prefs";
import { usePreferences } from "./usePreferences";

// Must be mounted inside PlaygroundProvider (Task 8 mounts it); PreferencesProvider lives in the root layout, outside it.
export function ModeSpeedSync(): null {
  const { mode } = usePreferences();
  const store = usePlaygroundStore();
  const previous = useRef(mode);
  useEffect(() => {
    if (previous.current === mode) return;
    previous.current = mode;
    store.getState().setSpeed(modeDefaults(mode).speed);
  }, [mode, store]);
  return null;
}
