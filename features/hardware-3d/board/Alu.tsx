"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Mesh } from "three";
import type { AluOp } from "@/core/hardware/classifyInstruction";
import type { HardwareFrame } from "../../playground/hooks/useHardwareFrame";
import { Z, type SceneProps } from "./sceneTypes";
import { useShapeGeometry, useTokenMaterial } from "./sharedResources";
import { useTextLabel } from "./useTextLabel";

/** The op as the ALU shows it. */
export function aluLabel(op: AluOp): string {
  switch (op) {
    case "add":
      return "add +";
    case "sub":
      return "sub -";
    case "and":
      return "and &";
    case "or":
      return "or |";
    case "xor":
      return "xor ^";
    case "shl":
      return "shl <<";
    case "sar":
      return "sar >>";
    case "cmp":
      return "cmp";
    case "test":
      return "test";
    case "inc":
      return "inc +1";
    case "dec":
      return "dec -1";
    case "neg":
      return "neg";
    case "imul":
      return "imul *";
    default: {
      const never: never = op;
      return never;
    }
  }
}

/** A raised trapezoid labelled with `hw.alu`; it is lit (current) while an op runs and reads idle otherwise. */
export function Alu({ frame, theme, layout }: SceneProps) {
  const geometry = useShapeGeometry("alu");
  const idle = useTokenMaterial(theme, "secondary", "lit");
  const lit = useTokenMaterial(theme, "current", "lit");
  const mesh = useRef<Mesh>(null);
  const label = useTextLabel(theme, layout.alu.w * 0.8, layout.alu.h * 0.8);
  const shown = useRef<string | undefined>(undefined);
  const last = useRef<HardwareFrame | null | undefined>(undefined);

  // New sprite (a composition change) starts blank.
  useEffect(() => {
    shown.current = undefined;
    last.current = undefined;
    theme.invalidate();
  }, [label, theme]);

  useFrame(() => {
    const f = frame.current;
    if (f === last.current) return;
    last.current = f;
    const op = f?.hw?.alu ?? null;
    const m = mesh.current;
    if (m) m.material = op === null ? idle : lit;
    const text = op === null ? "idle" : aluLabel(op);
    if (text === shown.current) return;
    shown.current = text;
    const tone = op === null ? "mutedForeground" : "background";
    label.set([
      { text: "ALU", size: 0.4, tone, mono: true },
      { text, size: 0.62, tone: op === null ? "foreground" : "background", mono: true, bold: true },
    ]);
  });

  const { alu } = layout;
  return (
    <group>
      <mesh ref={mesh} geometry={geometry} material={idle} position={[alu.x, alu.y, Z.dieTop]} scale={[alu.w, alu.h, Z.aluDepth]} />
      <primitive object={label.sprite} position={[alu.x, alu.y, Z.dieTop + Z.aluDepth + 0.4]} />
    </group>
  );
}
