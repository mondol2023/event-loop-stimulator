"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, type RefObject } from "react";

/** The panel enter: 220 ms, ease-out, opacity and transform only (docs/design/internals-hardware-shape.md §5, §8). */
export const ENTER_SECONDS = 0.22;
const ENTER_EASE = [0.165, 0.84, 0.44, 1] as const;

/**
 * Fades and slides the element in from `from` (px) while `active`; nothing moves under reduced motion.
 * Imperative on purpose: the element renders plain on the server, so no `style` attribute reaches the CSP-bound HTML (ADR-012).
 */
export function useEnterMotion<T extends Element>(active: boolean, from: { x?: number; y?: number }): RefObject<T | null> {
  const ref = useRef<T>(null);
  const reduce = useReducedMotion() === true;
  const x = from.x ?? 0;
  const y = from.y ?? 0;
  useEffect(() => {
    const el = ref.current;
    if (!active || reduce || !el) return;
    const controls = animate(el, { opacity: [0, 1], transform: [`translate(${x}px, ${y}px)`, "translate(0px, 0px)"] }, { duration: ENTER_SECONDS, ease: ENTER_EASE });
    return () => controls.cancel();
  }, [active, reduce, x, y]);
  return ref;
}
