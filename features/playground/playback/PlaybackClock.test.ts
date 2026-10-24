import { describe, expect, it } from "vitest";
import { fixtureRun } from "../test/fixtureTimeline";
import { createPlaygroundStore, type PlaybackSpeed } from "../store/playgroundStore";
import { createPlaybackClock, MAX_FRAME_DELTA_MS } from "./PlaybackClock";

function setup(speed: PlaybackSpeed) {
  const { compiled, simulated } = fixtureRun("nexttick-vs-promise");
  const store = createPlaygroundStore();
  store.getState().applyPipelineEvent({ kind: "response", response: compiled });
  store.getState().applyPipelineEvent({ kind: "response", response: simulated });
  store.getState().setSpeed(speed);
  let nextHandle = 1;
  const pending = new Map<number, (nowMs: number) => void>();
  const cancelled: number[] = [];
  const clock = createPlaybackClock({
    store,
    requestFrame: (cb) => {
      pending.set(nextHandle, cb);
      return nextHandle++;
    },
    cancelFrame: (h) => {
      cancelled.push(h);
      pending.delete(h);
    },
  });
  // Fires the single pending frame, if any, at the given timestamp.
  const fire = (nowMs: number): boolean => {
    const entry = [...pending.entries()][0];
    if (!entry) return false;
    pending.delete(entry[0]);
    entry[1](nowMs);
    return true;
  };
  // Plays from t=0 and fires frames of `step` ms until `totalMs` has elapsed.
  const run = (totalMs: number, step = 16): void => {
    let t = 0;
    fire(t);
    while (t < totalMs) {
      t += Math.min(step, totalMs - t);
      fire(t);
    }
  };
  return { store, clock, pending, cancelled, fire, run };
}

describe("PlaybackClock", () => {
  it("advances exactly 4 ticks in 1000 ms at speed 1", () => {
    const { store, run } = setup(1);
    store.getState().play();
    run(1000);
    expect(store.getState().playback.index).toBe(4);
  });

  it("advances 32 ticks in 1000 ms at speed 8", () => {
    const { store, run } = setup(8);
    expect(store.getState().playback.length).toBeGreaterThan(33);
    store.getState().play();
    run(1000);
    expect(store.getState().playback.index).toBe(32);
  });

  it("advances nothing in 250 ms and one tick in 1000 ms at speed 0.25", () => {
    const a = setup(0.25);
    a.store.getState().play();
    a.run(250);
    expect(a.store.getState().playback.index).toBe(0);
    const b = setup(0.25);
    b.store.getState().play();
    b.run(1000);
    expect(b.store.getState().playback.index).toBe(1);
  });

  it("advances a 30 s frame gap by at most one clamped frame", () => {
    for (const speed of [1, 4, 8] as const) {
      const { store, fire } = setup(speed);
      store.getState().play();
      fire(0);
      fire(30_000);
      expect(store.getState().playback.index).toBeLessThanOrEqual(Math.ceil((MAX_FRAME_DELTA_MS * 4 * speed) / 1000));
    }
  });

  it("pauses at the last tick and requests no more frames", () => {
    const { store, pending, fire } = setup(8);
    const { length } = store.getState().playback;
    store.getState().play();
    let t = 0;
    fire(t);
    for (let i = 0; i < 10_000 && pending.size > 0; i++) fire((t += 250));
    expect(store.getState().playback.index).toBe(length - 1);
    expect(store.getState().playback.isPlaying).toBe(false);
    expect(pending.size).toBe(0);
  });

  it("calls seek no more than 4 times in a 1 s run at speed 1", () => {
    const { store, run } = setup(1);
    let seeks = 0;
    const original = store.getState().seek;
    store.setState({
      seek: (i) => {
        seeks++;
        original(i);
      },
    });
    store.getState().play();
    run(1000);
    expect(seeks).toBeLessThanOrEqual(4);
  });

  it("cancels the pending frame on pause and on dispose", () => {
    const { store, clock, pending, cancelled } = setup(1);
    store.getState().play();
    expect(pending.size).toBe(1);
    store.getState().pause();
    expect(pending.size).toBe(0);
    expect(cancelled).toHaveLength(1);
    store.getState().play();
    expect(pending.size).toBe(1);
    clock.dispose();
    expect(pending.size).toBe(0);
    expect(cancelled).toHaveLength(2);
    store.getState().pause();
    store.getState().play();
    expect(pending.size).toBe(0);
  });

  it("resets the accumulator on pause so a resume does not inherit a fraction", () => {
    const { store, fire } = setup(1);
    store.getState().play();
    fire(0);
    fire(200); // 0.8 of a tick
    store.getState().pause();
    store.getState().play();
    fire(10_000); // first frame after play only records the timestamp
    fire(10_100); // 0.4 of a tick; an inherited 0.8 would cross to 1
    expect(store.getState().playback.index).toBe(0);
  });
});
