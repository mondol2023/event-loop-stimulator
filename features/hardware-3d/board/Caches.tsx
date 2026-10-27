"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, Object3D } from "three";
import type { HardwareFrame } from "../../playground/hooks/useHardwareFrame";
import { CellPaint } from "./cellPaint";
import { placeLines } from "./cachePlacement";
import { Flashes } from "./flashes";
import type { Grid } from "./layout";
import { servedFlash, type CacheFlash } from "./served";
import { CACHE_FLASH_SECONDS, Z, type SceneProps } from "./sceneTypes";
import { useShapeGeometry, useWhiteMaterial } from "./sharedResources";
import { useTextLabel } from "./useTextLabel";

type Level = "l1" | "l2";
type GridProps = SceneProps & { level: Level; grid: Grid; title: string; titleAt: readonly [number, number] };

/** One cache level: a cell per line slot, the resident lines lit, and the served cell flashing green (hit) or red (miss). */
function CacheGrid({ frame, theme, reduced, level, grid, title, titleAt }: GridProps) {
  const count = grid.positions.length;
  const box = useShapeGeometry("box");
  const white = useWhiteMaterial();
  const mesh = useRef<InstancedMesh>(null);
  const label = useTextLabel(theme, 4.4, 0.7);
  const flashes = useMemo(() => new Flashes(count, CACHE_FLASH_SECONDS), [count]);
  const occupied = useRef(new Uint8Array(count));
  const kinds = useRef<(CacheFlash | null)[]>(Array.from({ length: count }, () => null));
  const last = useRef<HardwareFrame | null | undefined>(undefined);
  const repaint = useRef(true);
  const paint = useRef<CellPaint | null>(null);
  const tmp = useMemo(() => new Color(), []);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    grid.positions.forEach(([x, y], i) => {
      o.position.set(x, y, Z.dieTop + Z.cellDepth / 2);
      o.scale.set(grid.cell, grid.cell, Z.cellDepth);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    paint.current = new CellPaint(m);
    repaint.current = true;
    last.current = undefined;
    theme.invalidate();
  }, [grid, theme]);

  useEffect(() => {
    label.set([{ text: title, size: 0.5, tone: "mutedForeground", mono: true }]);
  }, [label, title]);

  useEffect(
    () =>
      theme.subscribe(() => {
        paint.current?.reset();
        repaint.current = true;
      }),
    [theme],
  );

  useFrame((state, delta) => {
    const f = frame.current;
    const changed = f !== last.current;
    if (changed) {
      last.current = f;
      const hw = f?.hw ?? null;
      const tags = hw ? hw[level] : [];
      const cells = placeLines(tags, count);
      occupied.current.fill(0);
      for (const cell of cells) occupied.current[cell] = 1;
      flashes.clear();
      kinds.current.fill(null);
      const flash = servedFlash(hw?.servedBy ?? null)[level];
      const served = cells.at(-1);
      if (flash && served !== undefined) {
        flashes.start(served);
        kinds.current[served] = flash;
      }
    }
    const animating = flashes.advance(delta, reduced.current);
    if (!changed && !animating && !repaint.current) return;
    repaint.current = false;
    const p = paint.current;
    if (p) {
      for (let i = 0; i < count; i++) {
        tmp.copy(occupied.current[i] ? theme.colors.mutedForeground : theme.colors.secondary);
        const kind = kinds.current[i];
        if (kind) tmp.lerp(kind === "hit" ? theme.colors.current : theme.colors.destructive, flashes.level(i));
        p.paint(i, tmp);
      }
      p.commit();
    }
    if (animating) state.invalidate();
  });

  return (
    <group>
      <instancedMesh ref={mesh} args={[box, white, count]} />
      <primitive object={label.sprite} position={[titleAt[0], titleAt[1], Z.label]} />
    </group>
  );
}

/** L1 (8 lines) and L2 (32 lines), drawn from `hw.l1` and `hw.l2`. */
export function Caches(props: SceneProps) {
  const { layout } = props;
  return (
    <>
      <CacheGrid {...props} level="l1" grid={layout.l1} title="L1 · 8 lines" titleAt={layout.labels.l1} />
      <CacheGrid {...props} level="l2" grid={layout.l2} title="L2 · 32 lines" titleAt={layout.labels.l2} />
    </>
  );
}
