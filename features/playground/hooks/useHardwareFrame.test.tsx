// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { Profiler, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { machineStateAt } from "@/core/baseline/machineState";
import { PlaygroundStoreContext } from "../store/PlaygroundContext";
import { createPlaygroundStore } from "../store/playgroundStore";
import { getTimeline } from "../store/timelineHolder";
import { fixtureRun, runSource } from "../test/fixtureTimeline";
import { type HardwareFrame, useHardwareFrame } from "./useHardwareFrame";

afterEach(cleanup);

function setup() {
  const { compiled, simulated } = fixtureRun("nexttick-vs-promise");
  const store = createPlaygroundStore();
  store.getState().applyPipelineEvent({ kind: "response", response: compiled });
  store.getState().applyPipelineEvent({ kind: "response", response: simulated });
  const timeline = getTimeline(store);
  const { baselines } = store.getState().compile;
  if (!timeline || !baselines) throw new Error("the fixture holds no timeline or baselines");
  return { store, timeline, baselines };
}

describe("useHardwareFrame", () => {
  it("renders once however many ticks are seeked, and keeps a live ref for the frame", () => {
    const { store, timeline, baselines } = setup();
    const spy = vi.fn<(frame: HardwareFrame | null) => void>();
    let renders = 0;
    let frame: { readonly current: HardwareFrame | null } | undefined;
    function Probe(): null {
      frame = useHardwareFrame(spy);
      useEffect(() => {});
      return null;
    }
    const view = render(
      <PlaygroundStoreContext.Provider value={store}>
        <Profiler id="probe" onRender={() => renders++}>
          <Probe />
        </Profiler>
      </PlaygroundStoreContext.Provider>,
    );
    expect(renders).toBe(1);

    let withMachine = -1;
    for (let i = 0; i < timeline.length; i++) {
      const tick = timeline.at(i);
      const baseline = tick.pos ? baselines[tick.pos.functionId] : undefined;
      if (baseline && machineStateAt(tick, baseline)) {
        withMachine = i;
        break;
      }
    }
    expect(withMachine, "the fixture has a tick inside a baseline-compiled function").toBeGreaterThanOrEqual(0);

    act(() => store.getState().seek(withMachine));
    spy.mockClear();
    // Alternating two indexes makes every one of the 100 seeks a real change; the last lands on the machine tick.
    const other = withMachine === 0 ? 1 : 0;
    for (let i = 0; i < 100; i++) act(() => store.getState().seek(i % 2 === 0 ? other : withMachine));
    expect(spy).toHaveBeenCalledTimes(100);
    expect(renders).toBe(1);
    expect(frame?.current?.tick.index).toBe(withMachine);
    expect(frame?.current?.machine).not.toBeNull();

    const calls = spy.mock.calls.length;
    view.unmount();
    act(() => store.getState().seek(other));
    expect(spy.mock.calls.length).toBe(calls);
  });
});

describe("useHardwareFrame across jobs (a stale index must never read the new job's arrays out of range)", () => {
  function mount(store: ReturnType<typeof createPlaygroundStore>) {
    const holder: { current: { readonly current: HardwareFrame | null } | undefined } = { current: undefined };
    function Probe(): null {
      holder.current = useHardwareFrame();
      return null;
    }
    render(
      <PlaygroundStoreContext.Provider value={store}>
        <Probe />
      </PlaygroundStoreContext.Provider>,
    );
    return () => holder.current?.current ?? null;
  }

  function smallJob() {
    const [compiled, simulated] = runSource("let a = 1;", 2);
    if (compiled?.type !== "compiled" || simulated?.type !== "simulated") throw new Error("expected a small job");
    return { compiled, simulated };
  }

  it("exposes the step of the current tick, and null past the end of the job's trace", () => {
    const { store, timeline } = setup();
    const frame = mount(store);
    const { hardware } = store.getState().compile;
    expect(timeline.length).toBeGreaterThan(31);
    act(() => store.getState().seek(30));
    expect(frame()?.hw).toBe(hardware[30]);

    const small = smallJob();
    expect(small.simulated.hardware.length).toBeLessThan(30);
    // The trace of a 3-tick-style job lands while the cursor still points at tick 30.
    act(() => store.setState((s) => ({ compile: { ...s.compile, hardware: small.simulated.hardware } })));
    expect(() => act(() => store.getState().seek(31))).not.toThrow();
    expect(frame()?.hw).toBeNull();
    act(() => store.getState().seek(0));
    expect(frame()?.hw).toBe(small.simulated.hardware[0]);
  });

  it("follows a whole job swap at index 30 without throwing", () => {
    const { store } = setup();
    const frame = mount(store);
    act(() => store.getState().seek(30));
    const small = smallJob();
    expect(() => {
      act(() => store.getState().applyPipelineEvent({ kind: "response", response: small.compiled }));
      expect(frame()).toBeNull();
      act(() => store.getState().applyPipelineEvent({ kind: "response", response: small.simulated }));
    }).not.toThrow();
    const hw = frame()?.hw;
    expect(hw === null || hw === small.simulated.hardware[frame()?.tick.index ?? -1]).toBe(true);
    expect(frame()?.tick.index).toBe(0);
  });
});
