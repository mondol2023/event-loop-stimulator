"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { InstancedMesh, Object3D, type Group, type Material, type Mesh } from "three";
import type { BusKind } from "@/core/hardware/classifyInstruction";
import type { HardwareFrame } from "../../playground/hooks/useHardwareFrame";
import { createLabel, css } from "./labels";
import type { Vec2 } from "./layout";
import { pointAlong } from "./pulsePath";
import { Z, type SceneProps } from "./sceneTypes";
import { useShapeGeometry, useTokenMaterial, useWhiteMaterial } from "./sharedResources";

const PULSE_SECONDS = 0.45;
const BAR = 0.16;

type BusToken = "mutedForeground" | "busRead" | "busWrite";

/** The token colour of a pulse: fetch is neutral, read blue, write pink. */
export function busToken(kind: BusKind): BusToken {
  switch (kind) {
    case "fetch":
      return "mutedForeground";
    case "read":
      return "busRead";
    case "write":
      return "busWrite";
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** A write travels from the die toward RAM; a fetch or read travels back toward the die. */
export function travelsTowardRam(kind: BusKind): boolean {
  switch (kind) {
    case "write":
      return true;
    case "fetch":
    case "read":
      return false;
    default: {
      const never: never = kind;
      return never;
    }
  }
}

function segments(layout: SceneProps["layout"]): { a: Vec2; b: Vec2 }[] {
  const paths = [...layout.internalBus, ...Object.values(layout.memoryBus)];
  return paths.flatMap((path) => path.slice(1).map((b, i) => ({ a: path[i] ?? b, b })));
}

/** The static bus bars, one moving pulse (with an arrowhead) per tick that touches memory, and the colour legend. */
export function Buses({ frame, theme, layout, reduced }: SceneProps) {
  const plane = useShapeGeometry("plane");
  const arrow = useShapeGeometry("arrow");
  const white = useWhiteMaterial();
  const fetch = useTokenMaterial(theme, "mutedForeground", "basic");
  const read = useTokenMaterial(theme, "busRead", "basic");
  const write = useTokenMaterial(theme, "busWrite", "basic");
  const materials: Record<BusToken, Material> = { mutedForeground: fetch, busRead: read, busWrite: write };
  const bars = useRef<InstancedMesh>(null);
  const pulse = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const head = useRef<Mesh>(null);
  const segs = useMemo(() => segments(layout), [layout]);
  const state = useRef<{ path: readonly Vec2[]; t: number; active: boolean }>({ path: [], t: 1, active: false });
  const last = useRef<HardwareFrame | null | undefined>(undefined);

  const legend = useMemo(
    () =>
      createLabel(theme, {
        width: 19,
        height: 0.9,
        draw: (pen) => {
          const { ctx, colors } = pen;
          const size = 0.5;
          const gap = 18;
          const items: { text: string; draw: (x: number, y: number) => void }[] = [
            { text: "fetch", draw: (x, y) => triangle(ctx, x, y, -1, css(colors.mutedForeground), pen.h) },
            { text: "read", draw: (x, y) => triangle(ctx, x, y, -1, css(colors.busRead), pen.h) },
            { text: "write", draw: (x, y) => triangle(ctx, x, y, 1, css(colors.busWrite), pen.h) },
            { text: "hit", draw: (x, y) => dot(ctx, x, y, true, css(colors.current), pen.h) },
            { text: "miss", draw: (x, y) => dot(ctx, x, y, false, css(colors.destructive), pen.h) },
          ];
          const icon = pen.h * 0.4;
          const widths = items.map((it) => icon + 6 + pen.measure(it.text, size, true));
          let x = (pen.w - (widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1))) / 2;
          items.forEach((it, i) => {
            it.draw(x, pen.h / 2);
            pen.text(it.text, { x: x + icon + 6, y: pen.h / 2, size, color: css(colors.mutedForeground), mono: true, align: "left" });
            x += (widths[i] ?? 0) + gap;
          });
        },
      }),
    [theme],
  );
  useEffect(() => () => legend.dispose(), [legend]);

  useLayoutEffect(() => {
    const m = bars.current;
    if (!m) return;
    const o = new Object3D();
    segs.forEach(({ a, b }, i) => {
      o.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Z.dieTop + 0.02);
      o.scale.set(Math.abs(b[0] - a[0]) + BAR, Math.abs(b[1] - a[1]) + BAR, 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, theme.colors.border);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    theme.invalidate();
  }, [segs, theme]);

  useEffect(
    () =>
      theme.subscribe(() => {
        const m = bars.current;
        if (!m) return;
        for (let i = 0; i < segs.length; i++) m.setColorAt(i, theme.colors.border);
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }),
    [segs, theme],
  );

  useFrame((s, delta) => {
    const f = frame.current;
    const g = pulse.current;
    const st = state.current;
    if (f !== last.current) {
      last.current = f;
      const bus = f?.hw?.bus ?? null;
      if (bus) {
        const path = layout.memoryBus[bus.region];
        st.path = travelsTowardRam(bus.kind) ? path : [...path].reverse();
        // Reduced motion: no travel, the arrow simply appears at the far end.
        st.t = reduced.current ? 1 : 0;
        st.active = true;
        const material = materials[busToken(bus.kind)];
        if (body.current) body.current.material = material;
        if (head.current) head.current.material = material;
      } else {
        st.active = false;
      }
    }
    if (g) g.visible = st.active;
    if (!st.active || !g) return;
    if (st.t < 1) {
      st.t = Math.min(1, st.t + delta / PULSE_SECONDS);
      s.invalidate();
    }
    const p = pointAlong(st.path, st.t);
    g.position.set(p.x, p.y, Z.dieTop + 0.2);
    g.rotation.z = p.angle;
  });

  return (
    <group>
      <instancedMesh ref={bars} name="bus-bars" args={[plane, white, Math.max(1, segs.length)]} />
      <group ref={pulse} name="bus-pulse" visible={false}>
        <mesh ref={body} geometry={plane} material={fetch} position={[-0.45, 0, 0]} scale={[0.9, 0.24, 1]} />
        <mesh ref={head} geometry={arrow} material={fetch} position={[0.15, 0, 0]} scale={[0.6, 0.6, 0.2]} />
      </group>
      <primitive object={legend.sprite} position={[layout.labels.legend[0], layout.labels.legend[1], Z.label]} />
    </group>
  );
}

function triangle(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 1 | -1, fill: string, h: number): void {
  const s = h * 0.2;
  ctx.fillStyle = fill;
  ctx.beginPath();
  // Pointing right (+1) or left (-1), inside a box 2 * s wide.
  ctx.moveTo(x + (dir === 1 ? 2 * s : 0), y);
  ctx.lineTo(x + (dir === 1 ? 0 : 2 * s), y - s);
  ctx.lineTo(x + (dir === 1 ? 0 : 2 * s), y + s);
  ctx.closePath();
  ctx.fill();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, solid: boolean, color: string, h: number): void {
  const r = h * 0.17;
  ctx.beginPath();
  ctx.arc(x + r + h * 0.03, y, r, 0, Math.PI * 2);
  if (solid) {
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, h * 0.07);
    ctx.stroke();
  }
}
