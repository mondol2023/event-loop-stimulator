import { describe, expect, it } from "vitest";
import { TimelineStore } from "@/core/timeline/TimelineStore";
import { fixtureRun, runSource } from "../test/fixtureTimeline";
import { createPlaygroundStore } from "./playgroundStore";
import { getTimeline } from "./timelineHolder";

const run = fixtureRun("nexttick-vs-promise");

function readyStore() {
  const store = createPlaygroundStore();
  store.getState().applyPipelineEvent({ kind: "response", response: run.compiled });
  store.getState().applyPipelineEvent({ kind: "response", response: run.simulated });
  return store;
}

function emptyStore() {
  const store = createPlaygroundStore();
  store.getState().applyPipelineEvent({ kind: "response", response: { type: "compiled", jobId: 1, diagnostics: [], strippedJs: "", views: null, lineIndex: null, baselines: null } });
  return store;
}

describe("pipeline events", () => {
  it("holds a timeline as long as the playback", () => {
    const store = readyStore();
    const { compile, playback } = store.getState();
    expect(compile.status).toBe("ready");
    expect(getTimeline(store)?.length).toBe(run.simulated.tickCount);
    expect(playback.length).toBe(run.simulated.tickCount);
    expect(compile.boundaries).toEqual(run.simulated.boundaries);
    expect(compile.markers).toEqual(run.simulated.markers);
  });

  it("resets markers in the same notification when a new job compiles", () => {
    const store = readyStore();
    expect(store.getState().compile.markers.length).toBeGreaterThan(0);
    store.getState().applyPipelineEvent({ kind: "response", response: { ...run.compiled, jobId: 2 } });
    expect(store.getState().compile.markers).toEqual([]);
  });

  it("swaps the timeline out in one notification when a new job compiles (D2)", () => {
    const store = readyStore();
    store.getState().seek(7);
    expect(store.getState().playback.index).toBe(7);
    const versionBefore = store.getState().compile.timelineVersion;
    let notifications = 0;
    store.subscribe(() => notifications++);

    store.getState().applyPipelineEvent({ kind: "response", response: { ...run.compiled, jobId: 2 } });

    expect(notifications).toBe(1);
    expect(getTimeline(store)).toBeNull();
    expect(store.getState().playback).toMatchObject({ length: 0, index: 0, isPlaying: false });
    expect(store.getState().compile.timelineVersion).toBe(versionBefore + 1);
    expect(store.getState().compile.status).toBe("simulating");
  });

  it("clears the hovered line when a new job compiles", () => {
    const store = readyStore();
    store.getState().setHover("bytecode", 40);
    store.getState().applyPipelineEvent({ kind: "response", response: { ...run.compiled, jobId: 2 } });
    expect(store.getState().hover).toEqual({ pane: null, line: null });
  });

  it("ends a refused program as refused, with its diagnostics and no timeline", () => {
    const store = readyStore();
    const compiled = runSource("with ({}) {}", 2)[0];
    if (compiled?.type !== "compiled" || compiled.diagnostics.length === 0) throw new Error("expected a refused program");
    store.getState().applyPipelineEvent({ kind: "response", response: compiled });
    const state = store.getState();
    expect(state.compile.status).toBe("refused");
    expect(state.editor.diagnostics).toEqual(compiled.diagnostics);
    expect(getTimeline(store)).toBeNull();
    expect(state.playback.length).toBe(0);
    expect(state.compile.views).toBeNull();
  });

  it("stops playback on a failed event, from either source", () => {
    for (const event of [
      { kind: "failed", jobId: 1, message: "worker crashed" } as const,
      { kind: "response", response: { type: "failed", jobId: 1, message: "worker crashed" } } as const,
    ]) {
      const store = readyStore();
      store.getState().play();
      expect(store.getState().playback.isPlaying).toBe(true);
      store.getState().applyPipelineEvent(event);
      expect(store.getState().compile).toMatchObject({ status: "failed", message: "worker crashed" });
      expect(store.getState().playback.isPlaying).toBe(false);
    }
  });

  it("drops the previous run's data when a job fails before it compiled", () => {
    const store = readyStore();
    store.getState().applyPipelineEvent({ kind: "started", jobId: 2 });
    expect(getTimeline(store)).not.toBeNull();
    const versionBefore = store.getState().compile.timelineVersion;
    store.getState().applyPipelineEvent({ kind: "failed", jobId: 2, message: "worker crashed" });
    const state = store.getState();
    expect(state.compile).toMatchObject({ status: "failed", jobId: 2, views: null, lineIndex: null, baselines: null, strippedJs: null, boundaries: [], markers: [] });
    expect(state.compile.timelineVersion).toBe(versionBefore + 1);
    expect(state.editor.diagnostics).toEqual([]);
    expect(getTimeline(store)).toBeNull();
    expect(state.playback).toMatchObject({ length: 0, index: 0, isPlaying: false });
  });

  it("keeps this job's own views when the simulation fails after it compiled", () => {
    const store = createPlaygroundStore();
    store.getState().applyPipelineEvent({ kind: "started", jobId: 1 });
    store.getState().applyPipelineEvent({ kind: "response", response: run.compiled });
    store.getState().applyPipelineEvent({ kind: "response", response: { type: "failed", jobId: 1, message: "boom" } });
    expect(store.getState().compile.status).toBe("failed");
    expect(store.getState().compile.views).not.toBeNull();
    expect(store.getState().compile.lineIndex).not.toBeNull();
  });

  it("fails on a corrupt timeline and keeps the holder empty", () => {
    const store = createPlaygroundStore();
    store.getState().applyPipelineEvent({ kind: "response", response: run.compiled });
    store.getState().applyPipelineEvent({ kind: "response", response: { ...run.simulated, timeline: "{not json" } });
    expect(store.getState().compile.status).toBe("failed");
    expect(store.getState().compile.message).not.toBeNull();
    expect(getTimeline(store)).toBeNull();
    expect(store.getState().playback.length).toBe(0);
  });

  it("ignores events from a job older than the current one", () => {
    const store = createPlaygroundStore();
    store.getState().applyPipelineEvent({ kind: "started", jobId: 2 });
    store.getState().applyPipelineEvent({ kind: "started", jobId: 1 });
    store.getState().applyPipelineEvent({ kind: "response", response: { ...run.compiled, jobId: 1 } });
    expect(store.getState().compile.jobId).toBe(2);
    expect(store.getState().compile.status).toBe("compiling");
    expect(store.getState().compile.timelineVersion).toBe(0);
  });
});

describe("timeline holder", () => {
  it("keeps the timeline out of everything reachable from the state", () => {
    const store = readyStore();
    expect(getTimeline(store)).toBeInstanceOf(TimelineStore);
    const seen = new Set<unknown>();
    const walk = (value: unknown): void => {
      if (typeof value !== "object" || value === null || seen.has(value)) return;
      seen.add(value);
      expect(value).not.toBeInstanceOf(TimelineStore);
      Object.values(value).forEach(walk);
    };
    walk(store.getState());
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe("playback", () => {
  it("clamps seek to the last tick", () => {
    const store = readyStore();
    store.getState().seek(10_000);
    expect(store.getState().playback.index).toBe(run.simulated.tickCount - 1);
    store.getState().seek(-5);
    expect(store.getState().playback.index).toBe(0);
  });

  it("leaves playback unchanged at length 0", () => {
    const store = emptyStore();
    const before = store.getState().playback;
    const { seek, step, play, jumpBoundary, togglePlay } = store.getState();
    seek(5);
    step(3);
    play();
    togglePlay();
    jumpBoundary(1);
    jumpBoundary(-1);
    expect(store.getState().playback).toEqual(before);
    expect(store.getState().playback.isPlaying).toBe(false);
  });

  it("restarts from the first tick when played at the last one", () => {
    const store = readyStore();
    store.getState().seek(10_000);
    expect(store.getState().playback.index).toBe(run.simulated.tickCount - 1);
    store.getState().play();
    expect(store.getState().playback).toMatchObject({ index: 0, isPlaying: true });
  });

  it("plays on from the current tick otherwise", () => {
    const store = readyStore();
    store.getState().seek(3);
    store.getState().play();
    expect(store.getState().playback).toMatchObject({ index: 3, isPlaying: true });
  });

  it("steps by a delta, clamped", () => {
    const store = readyStore();
    store.getState().step(2);
    expect(store.getState().playback.index).toBe(2);
    store.getState().step(-10);
    expect(store.getState().playback.index).toBe(0);
  });

  it("jumps between boundaries and falls back to the ends", () => {
    const store = readyStore();
    const { boundaries } = store.getState().compile;
    expect(boundaries[0]).toBe(0);
    const second = boundaries[1];
    if (second === undefined) throw new Error("fixture has one job");
    store.getState().jumpBoundary(1);
    expect(store.getState().playback.index).toBe(second);
    store.getState().jumpBoundary(-1);
    expect(store.getState().playback.index).toBe(0);
    store.getState().jumpBoundary(-1);
    expect(store.getState().playback.index).toBe(0);
    store.getState().seek(10_000);
    store.getState().jumpBoundary(1);
    expect(store.getState().playback.index).toBe(run.simulated.tickCount - 1);
  });
});

describe("initial options", () => {
  it("starts at the given playback speed, and at 1x without one", () => {
    expect(createPlaygroundStore({ speed: 2 }).getState().playback.speed).toBe(2);
    expect(createPlaygroundStore().getState().playback.speed).toBe(1);
  });
});
