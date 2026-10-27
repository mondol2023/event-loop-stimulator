// @vitest-environment jsdom
import { Profiler, Suspense, lazy, useEffect, type ComponentType, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { RootState } from "@react-three/fiber";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Group, InstancedMesh } from "three";
import { useHardwareFrame, type HardwareFrame } from "../playground/hooks/useHardwareFrame";
import { PlaygroundStoreContext } from "../playground/store/PlaygroundContext";
import { createPlaygroundStore } from "../playground/store/playgroundStore";
import { getTimeline } from "../playground/store/timelineHolder";
import { fixtureRun, runSource } from "../playground/test/fixtureTimeline";

// The real @react-three/fiber reconciler runs the real scene; only the WebGL renderer behind it is a stub, as jsdom has no GPU.
const harness = vi.hoisted(() => ({ roots: 0, state: null as RootState | null, sceneCommits: 0 }));

vi.mock("./webgl", () => ({ hasWebGL: () => true }));
vi.mock("./SvgBoard", () => ({ default: () => <svg role="img" aria-label="2D hardware board" /> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
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
vi.mock("@react-three/fiber", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-three/fiber")>();
  const { Profiler: SceneProfiler, useEffect: useMountEffect } = await import("react");
  const THREE = await import("three");
  // The real Canvas fills R3F's JSX catalogue with three; a bare root has to do the same.
  actual.extend(THREE as unknown as Parameters<typeof actual.extend>[0]);

  function stubRenderer(canvas: HTMLCanvasElement) {
    const noop = () => {};
    return {
      domElement: canvas,
      render: noop,
      setSize: noop,
      setPixelRatio: noop,
      setClearAlpha: noop,
      dispose: noop,
      forceContextLoss: noop,
      getPixelRatio: () => 1,
      shadowMap: { enabled: false, type: 0 },
      xr: { enabled: false, addEventListener: noop, removeEventListener: noop, setAnimationLoop: noop, connect: noop, dispose: noop },
      outputColorSpace: "srgb",
      toneMapping: 0,
    };
  }

  function TestCanvas({ children, onCreated }: { children: ReactNode; onCreated?: (state: RootState) => void }) {
    useMountEffect(() => {
      const canvas = document.createElement("canvas");
      const root = actual.createRoot(canvas);
      harness.roots += 1;
      void root
        .configure({
          // A stub renderer cannot satisfy WebGLRenderer's type.
          gl: stubRenderer(canvas) as unknown as import("three").WebGLRenderer,
          size: { width: 900, height: 300, top: 0, left: 0 },
          frameloop: "never",
          orthographic: true,
          camera: { position: [0, 25, 54], zoom: 20, near: 0.1, far: 200 },
          onCreated: (state) => {
            harness.state = state;
            onCreated?.(state);
          },
        })
        .then(() => {
          root.render(
            <SceneProfiler id="scene" onRender={() => void (harness.sceneCommits += 1)}>
              {children}
            </SceneProfiler>,
          );
        });
      return () => {
        harness.state = null;
        root.unmount();
      };
    }, []);
    return null;
  }

  return { ...actual, Canvas: TestCanvas };
});

import { HardwareView } from "./HardwareView";

function ctx2d() {
  const noop = () => {};
  return { clearRect: noop, fillText: noop, measureText: () => ({ width: 10 }), beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, fill: noop, stroke: noop, arc: noop };
}

function loadedStore(fixture = "recursion-factorial") {
  const { compiled, simulated } = fixtureRun(fixture);
  const store = createPlaygroundStore();
  store.getState().applyPipelineEvent({ kind: "response", response: compiled });
  store.getState().applyPipelineEvent({ kind: "response", response: simulated });
  return store;
}

type FrameHolder = { readonly current: HardwareFrame | null };

function Probe({ report }: { report: (frame: FrameHolder) => void }): null {
  const frame = useHardwareFrame();
  useEffect(() => report(frame));
  return null;
}

let clock = 0;
const advance = () => act(() => void harness.state?.advance((clock += 16)));

async function mountBoard(store: ReturnType<typeof loadedStore>, extra?: ReactNode, onDomCommit?: () => void) {
  const view = render(
    <PlaygroundStoreContext.Provider value={store}>
      <Profiler id="dom" onRender={() => onDomCommit?.()}>
        <HardwareView />
      </Profiler>
      {extra}
    </PlaygroundStoreContext.Provider>,
  );
  // The first mount imports three and drei, which is slow under jsdom.
  await waitFor(() => expect(harness.state?.scene.children.length ?? 0).toBeGreaterThan(0), { timeout: 30_000 });
  await advance();
  return view;
}

function ramCells(): InstancedMesh {
  let found: InstancedMesh | undefined;
  harness.state?.scene.traverse((o) => {
    if (o.name === "ram-cells") found = o as InstancedMesh;
  });
  if (!found) throw new Error("the RAM cells are not in the scene");
  return found;
}

vi.setConfig({ testTimeout: 60_000 });

beforeEach(() => {
  harness.roots = 0;
  harness.state = null;
  harness.sceneCommits = 0;
  clock = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx2d() as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // jsdom has no matchMedia; a test that defined one must not leak it (reduced motion) into the next.
  Reflect.deleteProperty(window, "matchMedia");
});

describe("the 3D board is driven by refs", () => {
  it("renders the labelled canvas and commits nothing, in either React root, across 50 seeks", async () => {
    const store = loadedStore();
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("no timeline");
    let domCommits = 0;
    await mountBoard(store, undefined, () => void (domCommits += 1));
    const canvas = harness.state?.gl.domElement;
    expect(canvas?.getAttribute("role")).toBe("img");
    expect(canvas?.getAttribute("aria-label")).toMatch(/^No baseline code|rax=0x/);

    const before = { dom: domCommits, scene: harness.sceneCommits };
    // Both profilers did see the mount, so a zero delta below is a measurement, not a dead probe.
    expect(before.dom).toBeGreaterThan(0);
    expect(before.scene).toBeGreaterThan(0);
    const colorVersion = ramCells().instanceColor?.version ?? 0;
    const labels = new Set<string>();
    for (let i = 0; i < 50; i++) {
      await act(async () => store.getState().seek(Math.floor((i * (timeline.length - 1)) / 49)));
      await advance();
      labels.add(canvas?.getAttribute("aria-label") ?? "");
    }

    // The scene did react to the seeks (the readout and the RAM fill changed), yet no React commit happened.
    expect(labels.size).toBeGreaterThan(5);
    expect(ramCells().instanceColor?.version ?? 0).toBeGreaterThan(colorVersion);
    expect({ dom: domCommits, scene: harness.sceneCommits }).toEqual(before);
    expect(harness.roots).toBe(1);
  });

  it("follows the Machine Code pane's syntax in the aria-label", async () => {
    const store = loadedStore();
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("no timeline");
    await mountBoard(store);
    const canvas = harness.state?.gl.domElement;
    let att = "";
    for (let i = 0; i < timeline.length && !att.includes("rax="); i++) {
      await act(async () => store.getState().seek(i));
      att = canvas?.getAttribute("aria-label") ?? "";
    }
    expect(att).toContain("rax=");
    await act(async () => store.getState().setAsmSyntax("intel"));
    const intel = canvas?.getAttribute("aria-label") ?? "";
    expect(intel).toContain("rax=");
    expect(intel).not.toBe(att);
    expect(intel.split(";")[1]).toBe(att.split(";")[1]);
  });

  it("keeps the scene mounted when a smaller job replaces the run at index 30, and never reads past the new trace (Review Focus 2)", async () => {
    const store = loadedStore();
    let probed: FrameHolder | undefined;
    await mountBoard(store, <Probe report={(f) => void (probed = f)} />);
    await act(async () => store.getState().seek(30));
    await advance();
    expect(probed?.current?.tick.index).toBe(30);

    const [compiled, simulated] = runSource("let a = 1;", 2);
    if (compiled?.type !== "compiled" || simulated?.type !== "simulated") throw new Error("expected a small job");
    const scene = harness.state?.scene;
    await act(async () => store.getState().applyPipelineEvent({ kind: "response", response: compiled }));
    await expect(advance()).resolves.not.toThrow();
    await act(async () => store.getState().applyPipelineEvent({ kind: "response", response: simulated }));
    await expect(advance()).resolves.not.toThrow();

    const frame = probed?.current;
    expect(frame === null || frame?.hw === null || (frame?.tick.index ?? 99) <= 2).toBe(true);
    expect(frame?.tick.index ?? 0).toBeLessThanOrEqual(2);
    expect(harness.state?.scene).toBe(scene);
    expect(harness.roots).toBe(1);
    expect(screen.queryByRole("img", { name: "2D hardware board" })).toBeNull();
  });
});

describe("pulses and reduced motion", () => {
  function firstBusTick(store: ReturnType<typeof loadedStore>): number {
    const index = store.getState().compile.hardware.findIndex((h) => h.bus !== null);
    if (index < 0) throw new Error("no bus access in the trace");
    return index;
  }
  const pulse = (): Group => {
    let g: Group | undefined;
    harness.state?.scene.traverse((o) => {
      if (o.name === "bus-pulse") g = o as Group;
    });
    if (!g) throw new Error("no pulse group");
    return g;
  };

  it("travels with the frame delta, starting at the bus end", async () => {
    const store = loadedStore();
    await mountBoard(store);
    await act(async () => store.getState().seek(firstBusTick(store)));
    await advance();
    const g = pulse();
    expect(g.visible).toBe(true);
    const first = { x: g.position.x, y: g.position.y };
    await advance();
    await advance();
    expect(g.position.x !== first.x || g.position.y !== first.y).toBe(true);
  });

  it("puts the pulse at the far end at once under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduced-motion"), addEventListener: () => {}, removeEventListener: () => {} }));
    Object.defineProperty(window, "matchMedia", { configurable: true, value: window.matchMedia });
    const store = loadedStore();
    await mountBoard(store);
    await act(async () => store.getState().seek(firstBusTick(store)));
    await advance();
    const g = pulse();
    expect(g.visible).toBe(true);
    const settled = { x: g.position.x, y: g.position.y };
    await advance();
    await advance();
    expect({ x: g.position.x, y: g.position.y }).toEqual(settled);
  });
});

describe("the hit and miss cue (colour never stands alone)", () => {
  function cue(level: "l1" | "l2"): { visible: boolean; text: unknown } {
    let found: { visible: boolean; userData: { text?: unknown } } | undefined;
    harness.state?.scene.traverse((o) => {
      if (o.name === `cache-cue-${level}`) found = o;
    });
    if (!found) throw new Error(`no cue for ${level}`);
    return { visible: found.visible, text: found.userData.text };
  }
  function servedTick(store: ReturnType<typeof loadedStore>, level: "l1" | "l2" | "ram"): number {
    const index = store.getState().compile.hardware.findIndex((h) => h.servedBy === level);
    if (index < 0) throw new Error(`no ${level} access in the trace`);
    return index;
  }

  it("says hit beside the level that served, and miss beside both caches on a miss", async () => {
    const store = loadedStore();
    await mountBoard(store);
    await act(async () => store.getState().seek(servedTick(store, "l1")));
    await advance();
    expect(cue("l1")).toEqual({ visible: true, text: "hit" });
    expect(cue("l2").visible).toBe(false);

    await act(async () => store.getState().seek(servedTick(store, "ram")));
    await advance();
    expect(cue("l1")).toEqual({ visible: true, text: "miss" });
    expect(cue("l2")).toEqual({ visible: true, text: "miss" });
  });

  it("hides the cue when the flash has faded", async () => {
    const store = loadedStore();
    await mountBoard(store);
    await act(async () => store.getState().seek(servedTick(store, "l1")));
    await advance();
    expect(cue("l1").visible).toBe(true);
    // The canvas runs on demand here, so the frame delta is real elapsed time: wait out the 0.3 s flash.
    await new Promise((r) => setTimeout(r, 450));
    await advance();
    expect(cue("l1").visible).toBe(false);
  });

  it("shows the cue at once and keeps it under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduced-motion"), addEventListener: () => {}, removeEventListener: () => {} }));
    Object.defineProperty(window, "matchMedia", { configurable: true, value: window.matchMedia });
    const store = loadedStore();
    await mountBoard(store);
    await act(async () => store.getState().seek(servedTick(store, "l1")));
    await advance();
    await new Promise((r) => setTimeout(r, 450));
    await advance();
    expect(cue("l1")).toEqual({ visible: true, text: "hit" });
  });
});
