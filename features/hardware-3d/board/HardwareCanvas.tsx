"use client";

import { Canvas, useThree, type RootState } from "@react-three/fiber";
import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { OrthographicCamera } from "three";
import { usePlaygroundStore } from "../../playground/store/PlaygroundContext";
import { useHardwareFrame, type HardwareFrame } from "../../playground/hooks/useHardwareFrame";
import { PerfOverlay } from "../perf/PerfOverlay";
import { readout } from "../readout";
import { Alu } from "./Alu";
import { createBoardTheme } from "./boardColors";
import { Buses } from "./Buses";
import { Caches } from "./Caches";
import { CpuDie } from "./CpuDie";
import { frameloopMode } from "./frameloop";
import { boardLayout, compositionFor } from "./layout";
import { Ram } from "./Ram";
import { useReducedMotionRef } from "./reducedMotion";
import { RegisterBank } from "./RegisterBank";
import { Z } from "./sceneTypes";

// A fixed three-quarter view: the board stands facing the camera, tilted back by TILT, so label sprites stay square-on and readable.
const TILT = (25 * Math.PI) / 180;
const CAMERA_DISTANCE = 60;
const FIT_MARGIN = 1.04;
const COMPACT_HEIGHT_PX = 160;

// A stable reference: R3F's configure rebuilds the default camera when this prop changes, which would drop the fitted zoom.
const CAMERA = { position: [0, CAMERA_DISTANCE * Math.sin(TILT), CAMERA_DISTANCE * Math.cos(TILT)], zoom: 20, near: 0.1, far: 200 } as const;

type FrameRef = { readonly current: HardwareFrame | null };

function Scene({ frame, reduced }: { frame: FrameRef; reduced: { readonly current: boolean } }) {
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const get = useThree((s) => s.get);
  // One theme per canvas: its colours are mutated in place when <html> changes class.
  const theme = useMemo(() => createBoardTheme(invalidate), [invalidate]);
  useEffect(() => theme.connect(), [theme]);

  const layout = useMemo(() => boardLayout(compositionFor(size.width / Math.max(1, size.height))), [size.width, size.height]);
  const compact = size.height < COMPACT_HEIGHT_PX;

  // The camera fits the board on a container resize or composition change only, never per tick.
  useLayoutEffect(() => {
    const camera = get().camera as OrthographicCamera;
    const [w, h] = layout.size;
    const projectedHeight = h * Math.cos(TILT) + (Z.dieTop + Z.aluDepth) * Math.sin(TILT);
    camera.zoom = Math.min(size.width / (w * FIT_MARGIN), size.height / (projectedHeight * FIT_MARGIN));
    camera.position.set(0, CAMERA_DISTANCE * Math.sin(TILT), CAMERA_DISTANCE * Math.cos(TILT));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [get, invalidate, layout, size.width, size.height]);

  const props = { frame, theme, layout, reduced, compact } as const;
  return (
    <>
      <ambientLight intensity={1.6} />
      <directionalLight position={[4, 8, 20]} intensity={1.2} />
      <CpuDie {...props} />
      <Buses {...props} />
      <RegisterBank {...props} />
      <Alu {...props} />
      <Caches {...props} />
      <Ram {...props} />
      <PerformanceMonitor
        onDecline={() => {
          // While paused the canvas renders on demand, so a low fps there says nothing about the GPU.
          if (get().frameloop === "always") get().setDpr(1);
        }}
        onIncline={() => {
          if (get().frameloop === "always") get().setDpr(Math.min(2, window.devicePixelRatio));
        }}
      />
      <AdaptiveDpr pixelated />
      <PerfOverlay />
    </>
  );
}

/**
 * The 3D board. Nothing here subscribes React to the store: the tick reaches the scene through a ref, a store listener
 * asks the canvas for a frame, and the frame loop follows playback (D4: always while playing, demand while paused, never while hidden).
 */
export default function HardwareCanvas() {
  const store = usePlaygroundStore();
  const root = useRef<RootState | null>(null);
  const reduced = useReducedMotionRef();
  const detach = useRef<(() => void) | null>(null);
  const offscreen = useRef(false);

  const syncMode = useCallback(() => {
    const state = root.current;
    if (!state) return;
    const mode = frameloopMode({ playing: store.getState().playback.isPlaying, hidden: document.hidden || offscreen.current });
    const live = state.get();
    if (live.frameloop !== mode) live.setFrameloop(mode);
    live.invalidate();
  }, [store]);

  // The canvas element carries the readout as its accessible name; it is set through a ref, never state.
  const syncLabel = useCallback(
    (f: HardwareFrame | null) => {
      const el = root.current?.gl.domElement;
      if (!el) return;
      const { compile, asmSyntax } = store.getState();
      const baseline = f?.tick.pos ? compile.baselines?.[f.tick.pos.functionId] : undefined;
      el.setAttribute("aria-label", readout(f, baseline, asmSyntax));
    },
    [store],
  );

  const onFrame = useCallback(
    (f: HardwareFrame | null) => {
      syncLabel(f);
      root.current?.invalidate();
    },
    [syncLabel],
  );
  const frame = useHardwareFrame(onFrame);

  useEffect(() => {
    const offPlaying = store.subscribe((s) => s.playback.isPlaying, syncMode);
    const offSyntax = store.subscribe((s) => s.asmSyntax, () => syncLabel(frame.current));
    document.addEventListener("visibilitychange", syncMode);
    return () => {
      offPlaying();
      offSyntax();
      document.removeEventListener("visibilitychange", syncMode);
    };
  }, [store, syncMode, syncLabel, frame]);

  useEffect(() => () => detach.current?.(), []);

  const onCreated = useCallback(
    (state: RootState) => {
      root.current = state;
      const el = state.gl.domElement;
      el.setAttribute("role", "img");
      syncLabel(frame.current);
      let observer: IntersectionObserver | undefined;
      if (typeof IntersectionObserver !== "undefined") {
        observer = new IntersectionObserver((entries) => {
          offscreen.current = !(entries.at(-1)?.isIntersecting ?? true);
          syncMode();
        });
        observer.observe(el);
      }
      detach.current = () => observer?.disconnect();
      syncMode();
    },
    [frame, syncLabel, syncMode],
  );

  return (
    <Canvas
      orthographic
      flat
      dpr={[1, 2]}
      frameloop="demand"
      camera={CAMERA}
      onCreated={onCreated}
    >
      <Scene frame={frame} reduced={reduced} />
    </Canvas>
  );
}
