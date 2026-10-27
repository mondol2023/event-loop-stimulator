"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

declare global {
  interface Window {
    /** Task 11's e2e reads this: average fps since `?perf=1` mounted the sampler (D6 fallback). */
    __slHwFps?: () => number;
  }
}

// D6 fallback: r3f-perf injects an un-nonced <style> (stitches), which the CSP blocks and which then throws, so a rAF counter replaces it.
function startFpsSampler(): () => void {
  let frames = 0;
  const start = performance.now();
  let raf = requestAnimationFrame(function tick() {
    frames += 1;
    raf = requestAnimationFrame(tick);
  });
  window.__slHwFps = () => (frames * 1000) / Math.max(1, performance.now() - start);
  return () => {
    cancelAnimationFrame(raf);
    delete window.__slHwFps;
  };
}

/** Mounts the sampler only with `?perf=1`; renders nothing. */
export function PerfOverlay() {
  const enabled = useSearchParams().get("perf") === "1";
  useEffect(() => (enabled ? startFpsSampler() : undefined), [enabled]);
  return null;
}
