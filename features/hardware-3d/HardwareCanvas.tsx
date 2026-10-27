"use client";

import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import { PerfOverlay } from "./perf/PerfOverlay";

// Placeholder from Task 7's spike: Task 8 replaces the scene and keeps this default export.
export default function HardwareCanvas() {
  return (
    <Canvas>
      <PerformanceMonitor />
      <AdaptiveDpr pixelated />
      <ambientLight intensity={1} />
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial />
      </mesh>
      <PerfOverlay />
    </Canvas>
  );
}
