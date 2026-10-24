import { useEffect, useRef } from "react";
import { shallow } from "zustand/shallow";
import { machineStateAt, type MachineState } from "@/core/baseline/machineState";
import type { Tick } from "@/core/timeline/Tick";
import { usePlaygroundStore } from "../store/PlaygroundContext";
import type { PlaygroundState } from "../store/playgroundStore";
import { getTimeline } from "../store/timelineHolder";

export type HardwareFrame = { tick: Tick; machine: MachineState | null };

function frameOf(store: ReturnType<typeof usePlaygroundStore>, state: PlaygroundState): HardwareFrame | null {
  const timeline = getTimeline(store);
  if (!timeline || state.playback.length === 0) return null;
  const tick = timeline.at(state.playback.index);
  const baseline = tick.pos ? state.compile.baselines?.[tick.pos.functionId] : undefined;
  return { tick, machine: baseline ? machineStateAt(tick, baseline) : null };
}

/** The current tick and machine state in a ref, updated outside React so a seek never re-renders the caller; `onFrame` fires per update (e.g. a canvas invalidate). */
export function useHardwareFrame(onFrame?: (frame: HardwareFrame | null) => void): { readonly current: HardwareFrame | null } {
  const store = usePlaygroundStore();
  const ref = useRef<HardwareFrame | null>(null);
  // Latest callback without re-subscribing when its identity changes.
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    ref.current = frameOf(store, store.getState());
    const update = () => {
      ref.current = frameOf(store, store.getState());
      onFrameRef.current?.(ref.current);
    };
    return store.subscribe((s) => [s.playback.index, s.compile.timelineVersion] as const, update, { equalityFn: shallow });
  }, [store]);

  return ref;
}
