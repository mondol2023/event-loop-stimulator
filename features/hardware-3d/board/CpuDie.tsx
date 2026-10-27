"use client";

import { useEffect } from "react";
import type { BufferGeometry, Material } from "three";
import type { Rect } from "./layout";
import { Z, type SceneProps } from "./sceneTypes";
import { useShapeGeometry, useTokenMaterial } from "./sharedResources";
import { useTextLabel } from "./useTextLabel";

type SlabProps = { geometry: BufferGeometry; material: Material; rect: Rect; z: number; depth: number };

function Slab({ geometry, material, rect, z, depth }: SlabProps) {
  return <mesh geometry={geometry} material={material} position={[rect.x, rect.y, z]} scale={[rect.w, rect.h, depth]} />;
}

/** The substrate, the CPU die and the RAM module, with their titles. */
export function CpuDie({ theme, layout }: SceneProps) {
  const box = useShapeGeometry("box");
  const substrate = useTokenMaterial(theme, "secondary", "lit");
  const card = useTokenMaterial(theme, "card", "lit");
  const dieTitle = useTextLabel(theme, 7, 0.9);
  const ramTitle = useTextLabel(theme, 3, 0.9);

  useEffect(() => {
    dieTitle.set([{ text: "CPU (x86-64)", size: 0.6, tone: "mutedForeground", mono: true }]);
    ramTitle.set([{ text: "RAM", size: 0.6, tone: "mutedForeground", mono: true }]);
  }, [dieTitle, ramTitle]);

  return (
    <group>
      <Slab geometry={box} material={substrate} rect={layout.substrate} z={-0.4} depth={0.4} />
      <Slab geometry={box} material={card} rect={layout.die} z={Z.dieCenter} depth={Z.dieDepth} />
      <Slab geometry={box} material={card} rect={layout.ramModule} z={Z.dieCenter} depth={Z.dieDepth} />
      <primitive object={dieTitle.sprite} position={[layout.labels.die[0], layout.labels.die[1], Z.label]} />
      <primitive object={ramTitle.sprite} position={[layout.labels.ram[0], layout.labels.ram[1], Z.label]} />
    </group>
  );
}
