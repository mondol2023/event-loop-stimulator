"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, Object3D } from "three";
import type { MemRegion } from "@/core/hardware/classifyInstruction";
import type { HardwareFrame } from "../../playground/hooks/useHardwareFrame";
import { CellPaint } from "./cellPaint";
import { Flashes } from "./flashes";
import { RAM_CELL_COUNT, REGION_CELLS, REGION_OFFSET } from "./layout";
import { ramCell, ramFill } from "./ramFill";
import { CACHE_FLASH_SECONDS, Z, type SceneProps } from "./sceneTypes";
import { servedFlash } from "./served";
import { useShapeGeometry, useWhiteMaterial } from "./sharedResources";
import { useTextLabel } from "./useTextLabel";

const REGIONS: readonly MemRegion[] = ["code", "stack", "young", "old"];

const REGION_TITLE: Readonly<Record<MemRegion, string>> = { code: "code", stack: "stack", young: "young gen", old: "old gen" };

function RegionTitle({ region, ...scene }: SceneProps & { region: MemRegion }) {
  const label = useTextLabel(scene.theme, 4.2, 0.7);
  useEffect(() => {
    label.set([{ text: REGION_TITLE[region], size: 0.5, tone: "mutedForeground", mono: true }]);
  }, [label, region]);
  const at = scene.layout.labels.regions[region];
  return <primitive object={label.sprite} position={[at[0], at[1], Z.label]} />;
}

/**
 * All 208 RAM cells in one InstancedMesh (stack, young, old: 64 each, plus the 16-cell code strip).
 * The stack fills from the call-stack depth and young/old from the heap estimate; a miss in both caches lights the cell the line maps to.
 */
export function Ram(props: SceneProps) {
  const { frame, theme, layout, reduced } = props;
  const box = useShapeGeometry("box");
  const white = useWhiteMaterial();
  const mesh = useRef<InstancedMesh>(null);
  const flashes = useMemo(() => new Flashes(RAM_CELL_COUNT, CACHE_FLASH_SECONDS), []);
  const last = useRef<HardwareFrame | null | undefined>(undefined);
  const fill = useRef({ stack: 0, young: 0, old: 0 });
  const repaint = useRef(true);
  const paint = useRef<CellPaint | null>(null);
  const tmp = useMemo(() => new Color(), []);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    for (const region of REGIONS) {
      const grid = layout.ram[region];
      grid.positions.forEach(([x, y], i) => {
        o.position.set(x, y, Z.dieTop + Z.cellDepth / 2);
        o.scale.set(grid.cell, grid.cell, Z.cellDepth);
        o.updateMatrix();
        m.setMatrixAt(REGION_OFFSET[region] + i, o.matrix);
      });
    }
    m.instanceMatrix.needsUpdate = true;
    paint.current = new CellPaint(m);
    repaint.current = true;
    last.current = undefined;
    theme.invalidate();
  }, [layout, theme]);

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
      fill.current = f ? ramFill(f.tick) : { stack: 0, young: 0, old: 0 };
      flashes.clear();
      const hw = f?.hw ?? null;
      const tag = hw?.l2.at(-1);
      if (hw?.bus && tag !== undefined && servedFlash(hw.servedBy).ram) flashes.start(ramCell(hw.bus.region, tag));
    }
    const animating = flashes.advance(delta, reduced.current);
    if (!changed && !animating && !repaint.current) return;
    repaint.current = false;
    const p = paint.current;
    if (p) {
      for (const region of REGIONS) {
        const used = region === "code" ? REGION_CELLS.code : fill.current[region];
        for (let i = 0; i < REGION_CELLS[region]; i++) {
          const cell = REGION_OFFSET[region] + i;
          tmp.copy(i < used ? theme.colors.mutedForeground : theme.colors.secondary);
          const level = flashes.level(cell);
          if (level > 0) tmp.lerp(theme.colors.destructive, level);
          p.paint(cell, tmp);
        }
      }
      p.commit();
    }
    if (animating) state.invalidate();
  });

  return (
    <group>
      <instancedMesh ref={mesh} name="ram-cells" args={[box, white, RAM_CELL_COUNT]} />
      {REGIONS.map((region) => (
        <RegionTitle key={region} region={region} {...props} />
      ))}
    </group>
  );
}
