import type { PlaygroundStore } from "../store/playgroundStore";

/** Ticks per second at speed 1. */
export const BASE_TICKS_PER_SECOND = 4;
/** A backgrounded tab can hand us a huge gap; clamping it stops playback leaping ahead. */
export const MAX_FRAME_DELTA_MS = 250;

export type PlaybackClockDeps = {
  store: PlaygroundStore;
  requestFrame: (cb: (nowMs: number) => void) => number;
  cancelFrame: (handle: number) => void;
};

export function createPlaybackClock({ store, requestFrame, cancelFrame }: PlaybackClockDeps): { dispose(): void } {
  let handle: number | null = null;
  let lastMs: number | null = null;
  // Kept in milli-ticks (ms * ticks/s * speed) so fractional speeds sum without float drift.
  let accumulated = 0;

  function stop(): void {
    if (handle !== null) cancelFrame(handle);
    handle = null;
    lastMs = null;
    accumulated = 0;
  }

  function onFrame(nowMs: number): void {
    handle = null;
    const state = store.getState();
    if (!state.playback.isPlaying) return;
    // The first frame after play only records the timestamp.
    if (lastMs !== null) {
      const delta = Math.min(Math.max(nowMs - lastMs, 0), MAX_FRAME_DELTA_MS);
      accumulated += delta * BASE_TICKS_PER_SECOND * state.playback.speed;
      const whole = Math.floor(accumulated / 1000);
      if (whole >= 1) {
        accumulated -= whole * 1000;
        state.seek(state.playback.index + whole);
      }
    }
    lastMs = nowMs;
    const { index, length } = store.getState().playback;
    if (index >= length - 1) {
      store.getState().pause();
      return;
    }
    if (store.getState().playback.isPlaying) handle = requestFrame(onFrame);
  }

  function start(): void {
    if (handle === null) handle = requestFrame(onFrame);
  }

  const unsubscribe = store.subscribe(
    (s) => s.playback.isPlaying,
    (isPlaying) => (isPlaying ? start() : stop()),
    { fireImmediately: true },
  );

  return {
    dispose(): void {
      unsubscribe();
      stop();
    },
  };
}
