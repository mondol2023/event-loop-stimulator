// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { Profiler, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { machineStateAt } from "@/core/baseline/machineState";
import { PlaygroundStoreContext } from "../store/PlaygroundContext";
import { createPlaygroundStore } from "../store/playgroundStore";
import { getTimeline } from "../store/timelineHolder";
import { fixtureRun } from "../test/fixtureTimeline";
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
