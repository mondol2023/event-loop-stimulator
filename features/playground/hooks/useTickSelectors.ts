import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { LoopPhase, Tick, TickPhase } from "@/core/timeline/Tick";
import { usePlaygroundStore } from "../store/PlaygroundContext";
import { getTimeline } from "../store/timelineHolder";

// Each hook reads one slice of the current tick and is shallow-compared, so a seek re-renders a
// component only when the slice it reads actually changed. Empty results are module-level constants
// so a missing timeline returns the same reference every time.

const EMPTY_CALL_STACK: Tick["callStack"] = [];
const EMPTY_CONSOLE: Tick["console"] = [];
const EMPTY_WARNINGS: Tick["warnings"] = [];
const EMPTY_QUEUES: Queues = { nextTick: [], microtask: [], timers: [], immediates: [], hostApis: [] };
const EMPTY_LOOP_PHASE: LoopPhaseState = { phase: null, loopPhase: null };

export type Queues = {
  nextTick: Tick["nextTickQueue"];
  microtask: Tick["microtaskQueue"];
  timers: Tick["timerQueue"];
  immediates: Tick["immediateQueue"];
  hostApis: Tick["hostApis"];
};

export type LoopPhaseState = { phase: TickPhase | null; loopPhase: LoopPhase | null };

function useTick<T>(select: (tick: Tick) => T, empty: T): T {
  const store = usePlaygroundStore();
  return useStore(
    store,
    useShallow((s) => {
      // Read so the selector re-runs when the held timeline is replaced, not only when the cursor moves (D7).
      void s.compile.timelineVersion;
      const timeline = getTimeline(store);
      return timeline && s.playback.length > 0 ? select(timeline.at(s.playback.index)) : empty;
    }),
  );
}

const selectCallStack = (t: Tick) => t.callStack;
const selectQueues = (t: Tick): Queues => ({
  nextTick: t.nextTickQueue,
  microtask: t.microtaskQueue,
  timers: t.timerQueue,
  immediates: t.immediateQueue,
  hostApis: t.hostApis,
});
const selectLoopPhase = (t: Tick): LoopPhaseState => ({ phase: t.phase, loopPhase: t.loopPhase });
const selectConsole = (t: Tick) => t.console;
const selectV8 = (t: Tick): Tick["v8"] | null => t.v8;
const selectNarration = (t: Tick) => t.narration;
const selectWarnings = (t: Tick) => t.warnings;

export const useCallStack = (): Tick["callStack"] => useTick(selectCallStack, EMPTY_CALL_STACK);
/** The five queue arrays, each by reference, so only a queue that changed re-renders its reader. */
export const useQueues = (): Queues => useTick(selectQueues, EMPTY_QUEUES);
export const useLoopPhase = (): LoopPhaseState => useTick(selectLoopPhase, EMPTY_LOOP_PHASE);
export const useConsole = (): Tick["console"] => useTick(selectConsole, EMPTY_CONSOLE);
export const useV8State = (): Tick["v8"] | null => useTick(selectV8, null);
export const useNarration = (): string => useTick(selectNarration, "");
export const useFidelityWarnings = (): Tick["warnings"] => useTick(selectWarnings, EMPTY_WARNINGS);
