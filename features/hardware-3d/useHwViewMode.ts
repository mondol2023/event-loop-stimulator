"use client";

import { useCallback, useState } from "react";
import { hasWebGL } from "./webgl";

export type HardwareViewMode = "3d" | "2d";
export type HardwareViewReason = "user" | "no-webgl" | "context-lost" | "narrow" | null;

const STORAGE_KEY = "sl_hw_view";
const NARROW_QUERY = "(max-width: 767px)";

type State = { readonly mode: HardwareViewMode; readonly reason: HardwareViewReason };

// D5: every storage access is guarded, because storage can throw (blocked cookies, private windows).
function readStored(): HardwareViewMode | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "3d" || v === "2d" ? v : null;
  } catch {
    return null;
  }
}

function writeStored(mode: HardwareViewMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // The choice then lasts for this session only.
  }
}

function isNarrow(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;
  } catch {
    return false;
  }
}

// D5 (confirmed in Task 1): no WebGL wins, then the learner's saved choice, then the viewport.
function initialState(): State {
  if (typeof window === "undefined") return { mode: "3d", reason: null };
  if (!hasWebGL()) return { mode: "2d", reason: "no-webgl" };
  const stored = readStored();
  if (stored !== null) return { mode: stored, reason: "user" };
  return isNarrow() ? { mode: "2d", reason: "narrow" } : { mode: "3d", reason: null };
}

export function useHwViewMode(): {
  mode: HardwareViewMode;
  reason: HardwareViewReason;
  setMode: (m: HardwareViewMode) => void;
  /** Called when the canvas reports `webglcontextlost` (Review Focus 1); not persisted. */
  reportContextLost: () => void;
} {
  const [state, setState] = useState<State>(initialState);

  const setMode = useCallback((m: HardwareViewMode) => {
    if (m === "3d" && !hasWebGL()) {
      setState({ mode: "2d", reason: "no-webgl" });
      return;
    }
    writeStored(m);
    setState({ mode: m, reason: "user" });
  }, []);

  const reportContextLost = useCallback(() => setState({ mode: "2d", reason: "context-lost" }), []);

  return { mode: state.mode, reason: state.reason, setMode, reportContextLost };
}
