// @vitest-environment jsdom
import { Profiler, Suspense, lazy, type ComponentType, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webgl = vi.hoisted(() => ({ available: true }));

vi.mock("./webgl", () => ({ hasWebGL: () => webgl.available }));
// The real canvas pulls in three; the test only needs an element that can lose its context.
vi.mock("./board/HardwareCanvas", () => ({ default: () => <canvas data-testid="hw-canvas" /> }));
// next/dynamic needs Next's loadable runtime; React.lazy is the same contract for these tests.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: ComponentType } | ComponentType>) => {
    const Lazy = lazy(async () => {
      const m = await loader();
      return { default: "default" in m ? m.default : m };
    });
    return function Dynamic() {
      return (
        <Suspense fallback={null}>
          <Lazy />
        </Suspense>
      );
    };
  },
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

import { machineStateAt } from "@/core/baseline/machineState";
import { PlaygroundStoreContext } from "../playground/store/PlaygroundContext";
import { createPlaygroundStore } from "../playground/store/playgroundStore";
import { getTimeline } from "../playground/store/timelineHolder";
import { fixtureRun } from "../playground/test/fixtureTimeline";
import { HardwareView } from "./HardwareView";
import SvgBoard from "./SvgBoard";

type Store = ReturnType<typeof createPlaygroundStore>;

function loadedStore(fixture = "recursion-factorial"): Store {
  const { compiled, simulated } = fixtureRun(fixture);
  const store = createPlaygroundStore();
  store.getState().applyPipelineEvent({ kind: "response", response: compiled });
  store.getState().applyPipelineEvent({ kind: "response", response: simulated });
  return store;
}

function withStore(store: Store, children: ReactNode) {
  return <PlaygroundStoreContext.Provider value={store}>{children}</PlaygroundStoreContext.Provider>;
}

function raxAt(store: Store, index: number): bigint | null {
  const tick = getTimeline(store)?.at(index);
  const baseline = tick?.pos ? store.getState().compile.baselines?.[tick.pos.functionId] : undefined;
  return tick && baseline ? (machineStateAt(tick, baseline)?.registers.rax ?? null) : null;
}

const regValue = (container: HTMLElement, name: string) => container.querySelector(`[data-reg-value="${name}"]`)?.textContent;

function stubStorage(impl: Partial<Storage>) {
  vi.stubGlobal("localStorage", impl);
  Object.defineProperty(window, "localStorage", { configurable: true, value: impl });
}

describe("HardwareView", () => {
  beforeEach(() => {
    webgl.available = true;
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the SVG board and the notice when WebGL is unavailable", async () => {
    webgl.available = false;
    render(withStore(createPlaygroundStore(), <HardwareView />));
    expect(await screen.findByRole("group", { name: "2D hardware board" })).toBeTruthy();
    expect(screen.getByText("3D unavailable; showing the 2D board")).toBeTruthy();
    expect(screen.queryByTestId("hw-canvas")).toBeNull();
  });

  it("labels the registers with their V8 roles when WebGL is unavailable", async () => {
    webgl.available = false;
    render(withStore(createPlaygroundStore(), <HardwareView />));
    await screen.findByRole("group", { name: "2D hardware board" });
    expect(screen.getByText("rax")).toBeTruthy();
    expect(screen.getByText("accumulator")).toBeTruthy();
  });

  it("switches to the 2D board when the canvas loses its WebGL context", async () => {
    render(withStore(createPlaygroundStore(), <HardwareView />));
    const canvas = await screen.findByTestId("hw-canvas");
    expect(screen.getByRole("button", { name: "3D" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent(canvas, new Event("webglcontextlost", { bubbles: false, cancelable: true }));

    expect(await screen.findByRole("group", { name: "2D hardware board" })).toBeTruthy();
    expect(screen.getByText("3D unavailable; showing the 2D board")).toBeTruthy();
    expect(screen.getByRole("button", { name: "2D" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("hw-canvas")).toBeNull();
  });

  it("keeps the toggle working for the session when localStorage throws", async () => {
    const boom = () => {
      throw new DOMException("denied", "SecurityError");
    };
    stubStorage({ getItem: boom, setItem: boom, removeItem: boom, clear: boom });
    render(withStore(createPlaygroundStore(), <HardwareView />));
    await screen.findByTestId("hw-canvas");

    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    expect(await screen.findByRole("group", { name: "2D hardware board" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "2D" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("3D unavailable; showing the 2D board")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() => expect(screen.getByTestId("hw-canvas")).toBeTruthy());
    expect(screen.getByRole("button", { name: "3D" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("SvgBoard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("shows a register's value as hex text, in tabular numerals, after a seek", async () => {
    const store = loadedStore();
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("no timeline");
    const { container } = render(withStore(store, <SvgBoard />));
    let n = -1;
    for (let i = 0; i < timeline.length && n < 0; i++) if ((raxAt(store, i) ?? 0n) > 0n) n = i;
    expect(n).toBeGreaterThanOrEqual(0);
    await act(async () => store.getState().seek(n));
    expect(regValue(container, "rax")).toBe(`0x${raxAt(store, n)?.toString(16)}`);
    expect(container.querySelector('[data-reg-value="rax"]')?.getAttribute("class")).toContain("tabular-nums");
  });

  it("says hit beside L1 when it served the access, and miss beside both caches on a miss", async () => {
    const store = loadedStore();
    const { container } = render(withStore(store, <SvgBoard />));
    const cue = (level: string) => container.querySelector(`[data-cue="${level}"]`);
    const at = (served: string) => store.getState().compile.hardware.findIndex((h) => h.servedBy === served);
    await act(async () => store.getState().seek(at("l1")));
    expect(cue("l1")?.textContent).toBe("hit");
    expect(cue("l1")?.getAttribute("class")).not.toContain("hidden");
    expect(cue("l2")?.getAttribute("class")).toContain("hidden");
    await act(async () => store.getState().seek(at("ram")));
    expect(cue("l1")?.textContent).toBe("miss");
    expect(cue("l2")?.textContent).toBe("miss");
  });

  it("hides the cue once the flash has faded", async () => {
    vi.useFakeTimers();
    try {
      const store = loadedStore();
      const { container } = render(withStore(store, <SvgBoard />));
      const l1 = () => container.querySelector('[data-cue="l1"]')?.getAttribute("class") ?? "";
      const served = store.getState().compile.hardware.findIndex((h) => h.servedBy === "l1");
      await act(async () => store.getState().seek(served));
      expect(l1()).not.toContain("hidden");
      await act(async () => void vi.advanceTimersByTime(500));
      expect(l1()).toContain("hidden");
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits nothing in React across 50 seeks", async () => {
    const store = loadedStore();
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("no timeline");
    let commits = 0;
    const { container } = render(
      withStore(
        store,
        <Profiler id="svg" onRender={() => void (commits += 1)}>
          <SvgBoard />
        </Profiler>,
      ),
    );
    // The mount was seen, so a zero delta below is a measurement rather than a dead probe.
    expect(commits).toBeGreaterThan(0);
    const before = commits;
    const seen = new Set<string | null | undefined>();
    for (let i = 0; i < 50; i++) {
      await act(async () => store.getState().seek(Math.floor((i * (timeline.length - 1)) / 49)));
      seen.add(regValue(container, "rax"));
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(commits).toBe(before);
  });

  it("shows no value before a run", () => {
    const { container } = render(withStore(createPlaygroundStore(), <SvgBoard />));
    expect(regValue(container, "rax")).toBe("—");
  });
});
