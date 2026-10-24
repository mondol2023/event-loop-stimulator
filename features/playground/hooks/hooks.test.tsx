// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { Profiler, type ReactElement, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineStore } from "@/core/timeline/TimelineStore";
import { linesForPositions, positionsForLine } from "@/core/views/lineIndex";
import { PlaygroundStoreContext, usePlaygroundStore } from "../store/PlaygroundContext";
import { createPlaygroundStore, type PlaygroundStore } from "../store/playgroundStore";
import { getTimeline } from "../store/timelineHolder";
import { fixtureRun, runSource } from "../test/fixtureTimeline";
import { useHighlightedLines } from "./useHighlightedLines";
import { useCallStack, useConsole, useFidelityWarnings, useLoopPhase, useNarration, useQueues, useV8State } from "./useTickSelectors";

const run = fixtureRun("nexttick-vs-promise");

/** Reads the store from context only, never a tick: the control that must not render. */
function useContextOnly(): null {
  usePlaygroundStore();
  return null;
}

const useBytecodeLines = () => useHighlightedLines("bytecode");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function readyStore(name?: string): PlaygroundStore {
  const { compiled, simulated } = name ? fixtureRun(name) : run;
  const store = createPlaygroundStore();
  store.getState().applyPipelineEvent({ kind: "response", response: compiled });
  store.getState().applyPipelineEvent({ kind: "response", response: simulated });
  return store;
}

function refusedStore(): PlaygroundStore {
  const store = createPlaygroundStore();
  const compiled = runSource("with ({}) {}", 1)[0];
  if (compiled?.type !== "compiled" || compiled.diagnostics.length === 0) throw new Error("expected a refused program");
  store.getState().applyPipelineEvent({ kind: "response", response: compiled });
  return store;
}

function timelineOf(store: PlaygroundStore): TimelineStore {
  const timeline = getTimeline(store);
  if (!timeline) throw new Error("the store holds no timeline");
  return timeline;
}

/** Renders `probes` inside the provider; each is counted by its own Profiler, which fires once per commit that re-rendered it. */
function mount(store: PlaygroundStore, probes: Record<string, () => unknown>) {
  const renders: Record<string, number> = {};
  const values: Record<string, unknown> = {};
  function Probe({ name, use }: { name: string; use: () => unknown }): null {
    const value = use();
    useEffect(() => {
      values[name] = value;
    });
    return null;
  }
  const tree: ReactElement = (
    <PlaygroundStoreContext.Provider value={store}>
      {Object.entries(probes).map(([name, use]) => (
        <Profiler
          key={name}
          id={name}
          onRender={() => {
            renders[name] = (renders[name] ?? 0) + 1;
          }}
        >
          <Probe name={name} use={use} />
        </Profiler>
      ))}
    </PlaygroundStoreContext.Provider>
  );
  render(tree);
  return {
    /** Renders since this call, so each assertion measures only what it just did. */
    since: () => {
      const baseline = { ...renders };
      return (name: string) => (renders[name] ?? 0) - (baseline[name] ?? 0);
    },
    value: (name: string) => values[name],
  };
}

const seek = (store: PlaygroundStore, index: number) => act(() => store.getState().seek(index));

function shallowEqualArrays(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

describe("render counts follow the tick fields a component reads", () => {
  it("re-renders the call stack probe once and the console probe never when only the call stack changes", () => {
    const store = readyStore();
    const timeline = timelineOf(store);
    let a = -1;
    for (let i = 0; i + 1 < timeline.length; i++) {
      if (timeline.at(i).console === timeline.at(i + 1).console && !shallowEqualArrays(timeline.at(i).callStack, timeline.at(i + 1).callStack)) {
        a = i;
        break;
      }
    }
    expect(a, "the fixture has two adjacent ticks that share console but not callStack").toBeGreaterThanOrEqual(0);
    const b = a + 1;
    seek(store, a);

    const view = mount(store, { callStack: useCallStack, console: useConsole });
    const count = view.since();
    seek(store, b);

    expect(count("callStack")).toBe(1);
    expect(count("console")).toBe(0);
    expect(view.value("callStack")).toBe(timeline.at(b).callStack);
    expect(view.value("console")).toBe(timeline.at(a).console);
  });

  it("never renders a component that reads no tick hook, across 50 seeks", () => {
    const store = readyStore();
    const view = mount(store, {
      none: useContextOnly,
      callStack: useCallStack,
    });
    const count = view.since();
    for (let i = 0; i < 50; i++) seek(store, (i * 3) % run.simulated.tickCount);
    expect(store.getState().playback.index).not.toBe(0);
    expect(count("none")).toBe(0);
    expect(count("callStack")).toBeGreaterThan(0);
  });

  // bc-break-continue repeats narration on adjacent ticks, so this can tell "narration changed" from "a tick changed".
  it("re-renders the narration probe only on ticks whose narration differs from the previous tick", () => {
    const store = readyStore("bc-break-continue");
    const timeline = timelineOf(store);
    let changes = 0;
    for (let i = 1; i < timeline.length; i++) if (timeline.at(i).narration !== timeline.at(i - 1).narration) changes++;
    expect(changes).toBeGreaterThan(0);
    expect(changes).toBeLessThan(timeline.length - 1);

    const view = mount(store, { narration: useNarration });
    const count = view.since();
    for (let i = 1; i < timeline.length; i++) seek(store, i);
    expect(count("narration")).toBe(changes);
    expect(view.value("narration")).toBe(timeline.at(timeline.length - 1).narration);
  });

  it("keeps the other selectors in step with the tick they read", () => {
    const store = readyStore();
    const timeline = timelineOf(store);
    const index = Math.floor(timeline.length / 2);
    const tick = timeline.at(index);
    seek(store, index);
    const view = mount(store, {
      queues: useQueues,
      loop: useLoopPhase,
      v8: useV8State,
      warnings: useFidelityWarnings,
    });
    expect(view.value("queues")).toEqual({
      nextTick: tick.nextTickQueue,
      microtask: tick.microtaskQueue,
      timers: tick.timerQueue,
      immediates: tick.immediateQueue,
      hostApis: tick.hostApis,
    });
    const queues = view.value("queues") as Record<string, unknown>;
    expect(queues["nextTick"]).toBe(tick.nextTickQueue);
    expect(queues["hostApis"]).toBe(tick.hostApis);
    expect(view.value("loop")).toEqual({ phase: tick.phase, loopPhase: tick.loopPhase });
    expect(view.value("v8")).toBe(tick.v8);
    expect(view.value("warnings")).toBe(tick.warnings);
  });

  it("does not re-render the loop phase or queue probes when a seek lands on an equal value", () => {
    const store = readyStore();
    const timeline = timelineOf(store);
    let a = -1;
    for (let i = 0; i + 1 < timeline.length; i++) {
      const x = timeline.at(i);
      const y = timeline.at(i + 1);
      if (x.phase === y.phase && x.loopPhase === y.loopPhase && shallowEqualArrays(x.nextTickQueue, y.nextTickQueue)) {
        a = i;
        break;
      }
    }
    expect(a).toBeGreaterThanOrEqual(0);
    seek(store, a);
    const view = mount(store, { loop: useLoopPhase });
    const count = view.since();
    seek(store, a + 1);
    expect(count("loop")).toBe(0);
  });
});

describe("useHighlightedLines", () => {
  function lineIndexOf(store: PlaygroundStore) {
    const { lineIndex } = store.getState().compile;
    if (!lineIndex) throw new Error("the store has no line index");
    return lineIndex;
  }

  it("highlights the bytecode lines of the current position", () => {
    const store = readyStore();
    const timeline = timelineOf(store);
    const lineIndex = lineIndexOf(store);
    let index = -1;
    for (let i = 0; i < timeline.length; i++) {
      const pos = timeline.at(i).pos;
      if (pos && linesForPositions(lineIndex, "bytecode", [pos]).length > 0) {
        index = i;
        break;
      }
    }
    expect(index).toBeGreaterThanOrEqual(0);
    seek(store, index);
    const view = mount(store, { lines: useBytecodeLines });
    const pos = timeline.at(index).pos;
    if (!pos) throw new Error("unreachable");
    const lines = view.value("lines") as { current: number[]; hovered: number[] };
    expect(lines.current).toEqual(linesForPositions(lineIndex, "bytecode", [pos]));
    expect(lines.current.length).toBeGreaterThan(0);
    expect(lines.hovered).toEqual([]);
  });

  it("fills hovered with the pane's lines for a hovered line of another pane", () => {
    const store = readyStore();
    const lineIndex = lineIndexOf(store);
    const sourceLine = lineIndex.source.findIndex((positions) => positions.length > 0 && linesForPositions(lineIndex, "bytecode", positions).length > 0);
    expect(sourceLine).toBeGreaterThanOrEqual(0);
    const view = mount(store, { lines: useBytecodeLines });
    act(() => store.getState().setHover("source", sourceLine));
    const expected = linesForPositions(lineIndex, "bytecode", positionsForLine(lineIndex, "source", sourceLine));
    expect(expected.length).toBeGreaterThan(0);
    expect((view.value("lines") as { hovered: number[] }).hovered).toEqual(expected);
    act(() => store.getState().clearHover());
    expect((view.value("lines") as { hovered: number[] }).hovered).toEqual([]);
  });

  it("includes the hovered line itself when it is in the same pane", () => {
    const store = readyStore();
    const lineIndex = lineIndexOf(store);
    const line = lineIndex.panes.bytecode.findIndex((positions) => positions.length > 0);
    expect(line).toBeGreaterThanOrEqual(0);
    const view = mount(store, { lines: useBytecodeLines });
    act(() => store.getState().setHover("bytecode", line));
    expect((view.value("lines") as { hovered: number[] }).hovered).toContain(line);
  });

  it("does not re-render when a seek keeps the same position", () => {
    const store = readyStore("bc-named-expression");
    const timeline = timelineOf(store);
    let a = -1;
    for (let i = 0; i + 1 < timeline.length; i++) {
      const x = timeline.at(i).pos;
      const y = timeline.at(i + 1).pos;
      // Patches may hand back a fresh object with the same coordinates, so equality has to be by value.
      if (x && y && x.functionId === y.functionId && x.bytecodeOffset === y.bytecodeOffset) {
        a = i;
        break;
      }
    }
    expect(a, "the fixture has two adjacent ticks at the same position").toBeGreaterThanOrEqual(0);
    seek(store, a);
    const view = mount(store, { lines: useBytecodeLines });
    const count = view.since();
    seek(store, a + 1);
    expect(count("lines")).toBe(0);
  });

  it("re-renders when the highlighted lines change", () => {
    const store = readyStore();
    const timeline = timelineOf(store);
    const lineIndex = lineIndexOf(store);
    const linesAt = (i: number) => {
      const pos = timeline.at(i).pos;
      return pos ? linesForPositions(lineIndex, "bytecode", [pos]) : [];
    };
    let a = -1;
    for (let i = 0; i + 1 < timeline.length; i++) {
      if (!shallowEqualArrays(linesAt(i), linesAt(i + 1))) {
        a = i;
        break;
      }
    }
    expect(a).toBeGreaterThanOrEqual(0);
    seek(store, a);
    const view = mount(store, { lines: useBytecodeLines });
    const count = view.since();
    seek(store, a + 1);
    expect(count("lines")).toBe(1);
  });
});

describe("a program with no timeline", () => {
  const allHooks = {
    callStack: useCallStack,
    queues: useQueues,
    loop: useLoopPhase,
    console: useConsole,
    v8: useV8State,
    narration: useNarration,
    warnings: useFidelityWarnings,
    lines: useBytecodeLines,
  };

  it("returns the empty value from every hook and never touches the timeline", () => {
    const at = vi.spyOn(TimelineStore.prototype, "at");
    const store = refusedStore();
    const view = mount(store, allHooks);
    expect(view.value("callStack")).toEqual([]);
    expect(view.value("queues")).toEqual({ nextTick: [], microtask: [], timers: [], immediates: [], hostApis: [] });
    expect(view.value("loop")).toEqual({ phase: null, loopPhase: null });
    expect(view.value("console")).toEqual([]);
    expect(view.value("v8")).toBeNull();
    expect(view.value("narration")).toBe("");
    expect(view.value("warnings")).toEqual([]);
    expect(view.value("lines")).toEqual({ current: [], hovered: [] });

    const first = { ...allHooksValues(view) };
    const count = view.since();
    act(() => store.getState().seek(5));
    act(() => store.getState().setHover("source", 0));
    for (const name of Object.keys(allHooks)) expect(count(name), name).toBe(0);
    for (const [name, value] of Object.entries(allHooksValues(view))) expect(value, name).toBe(first[name]);
    expect(at).not.toHaveBeenCalled();
  });

  it("keeps empty results reference-stable when a new refused job replaces the old one", () => {
    const store = refusedStore();
    const view = mount(store, allHooksNoLines());
    const first = allHooksValues(view);
    const count = view.since();
    const compiled = runSource("with ({}) {}", 2)[0];
    if (compiled?.type !== "compiled") throw new Error("expected a compiled response");
    act(() => store.getState().applyPipelineEvent({ kind: "response", response: compiled }));
    expect(store.getState().compile.jobId).toBe(2);
    for (const [name, value] of Object.entries(allHooksValues(view))) {
      expect(value, name).toBe(first[name]);
      expect(count(name), name).toBe(0);
    }
  });

  function allHooksNoLines() {
    return Object.fromEntries(Object.entries(allHooks).filter(([name]) => name !== "lines"));
  }

  function allHooksValues(view: ReturnType<typeof mount>): Record<string, unknown> {
    return Object.fromEntries(Object.keys(allHooksNoLines()).map((name) => [name, view.value(name)]));
  }
});

describe("D2: a new job's compile swaps the timeline out", () => {
  it("re-renders the call stack probe once, to the empty value", () => {
    const store = readyStore();
    const timeline = timelineOf(store);
    let index = -1;
    for (let i = 0; i < timeline.length; i++) {
      if (timeline.at(i).callStack.length > 0) {
        index = i;
        break;
      }
    }
    expect(index).toBeGreaterThanOrEqual(0);
    seek(store, index);
    const view = mount(store, { callStack: useCallStack });
    expect((view.value("callStack") as unknown[]).length).toBeGreaterThan(0);
    const count = view.since();

    act(() => store.getState().applyPipelineEvent({ kind: "response", response: { ...run.compiled, jobId: 2 } }));

    expect(count("callStack")).toBe(1);
    expect(view.value("callStack")).toEqual([]);
  });
});
