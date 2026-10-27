"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, Object3D } from "three";
import type { HardwareFrame } from "../../playground/hooks/useHardwareFrame";
import { CellPaint } from "./cellPaint";
import { Flashes } from "./flashes";
import type { TextLabel } from "./labels";
import { FLASH_SECONDS, Z, type SceneProps } from "./sceneTypes";
import { REGISTER_NAMES, roleOf } from "./registerRoles";
import { NO_VALUE, registerText } from "./registerText";
import { useShapeGeometry, useWhiteMaterial } from "./sharedResources";
import { useTextLabelSet } from "./useTextLabel";

/** 16 register tiles in one InstancedMesh, each with its name and V8 role (drawn once) and its hex value (redrawn when it changes). */
export function RegisterBank({ frame, theme, layout, reduced, compact }: SceneProps) {
  const box = useShapeGeometry("box");
  const white = useWhiteMaterial();
  const mesh = useRef<InstancedMesh>(null);
  const names = useTextLabelSet(theme, 16, layout.registers[0]?.w ?? 1, (layout.registers[0]?.h ?? 1) * 0.55);
  const values = useTextLabelSet(theme, 16, layout.registers[0]?.w ?? 1, (layout.registers[0]?.h ?? 1) * 0.3);
  const flashes = useMemo(() => new Flashes(16, FLASH_SECONDS), []);
  const shown = useRef<(string | undefined)[]>(Array.from({ length: 16 }, () => undefined));
  const last = useRef<HardwareFrame | null | undefined>(undefined);
  const repaint = useRef(true);
  const paint = useRef<CellPaint | null>(null);
  const tmp = useMemo(() => new Color(), []);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    layout.registers.forEach((r, i) => {
      o.position.set(r.x, r.y, Z.dieTop + Z.tileDepth / 2);
      o.scale.set(r.w, r.h, Z.tileDepth);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    paint.current = new CellPaint(m);
    repaint.current = true;
    theme.invalidate();
  }, [layout, theme]);

  useEffect(() => {
    REGISTER_NAMES.forEach((name, i) => {
      names[i]?.set([
        { text: name, size: 0.5, tone: "foreground", mono: true, bold: true },
        { text: roleOf(name), size: 0.3, tone: "mutedForeground" },
      ]);
    });
  }, [names]);

  // New label sprites (a composition change) start blank, so everything is drawn again.
  useEffect(() => {
    shown.current.fill(undefined);
    last.current = undefined;
    theme.invalidate();
  }, [values, theme]);

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
      flashes.clear();
      REGISTER_NAMES.forEach((name, i) => {
        const text = registerText(name, f);
        const previous = shown.current[i];
        if (text === previous) return;
        shown.current[i] = text;
        values[i]?.set([{ text, size: 0.3, tone: text === NO_VALUE ? "mutedForeground" : "foreground", mono: true }]);
        // The first value after mount is not a change.
        if (previous !== undefined && text !== NO_VALUE) flashes.start(i);
      });
    }
    const animating = flashes.advance(delta, reduced.current);
    if (!changed && !animating && !repaint.current) return;
    repaint.current = false;
    const p = paint.current;
    if (p) {
      for (let i = 0; i < 16; i++) {
        tmp.copy(theme.colors.secondary).lerp(theme.colors.current, flashes.level(i));
        p.paint(i, tmp);
      }
      p.commit();
    }
    if (animating) state.invalidate();
  });

  return (
    <group>
      <instancedMesh ref={mesh} args={[box, white, 16]} />
      <TextRow labels={names} layout={layout} offset={0.225} />
      {compact ? null : <TextRow labels={values} layout={layout} offset={-0.35} />}
    </group>
  );
}

/** Places one label sprite on each register tile, `offset` as a fraction of the tile's height above its centre. */
function TextRow({ labels, layout, offset }: { labels: readonly TextLabel[]; layout: SceneProps["layout"]; offset: number }) {
  return (
    <>
      {layout.registers.map((r, i) => {
        const label = labels[i];
        return label ? <primitive key={i} object={label.sprite} position={[r.x, r.y + r.h * offset, Z.label]} /> : null;
      })}
    </>
  );
}
