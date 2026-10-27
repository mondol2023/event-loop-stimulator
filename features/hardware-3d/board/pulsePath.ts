import type { Vec2 } from "./layout";

export function pathLength(path: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot((path[i]?.[0] ?? 0) - (path[i - 1]?.[0] ?? 0), (path[i]?.[1] ?? 0) - (path[i - 1]?.[1] ?? 0));
  return total;
}

/** The point at fraction `t` (clamped to 0..1) of the polyline's length, with the heading of the segment it is on. */
export function pointAlong(path: readonly Vec2[], t: number): { x: number; y: number; angle: number } {
  let remaining = Math.min(Math.max(t, 0), 1) * pathLength(path);
  let x = path[0]?.[0] ?? 0;
  let y = path[0]?.[1] ?? 0;
  let angle = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1] ?? [0, 0];
    const [x1, y1] = path[i] ?? [0, 0];
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length === 0) continue;
    angle = Math.atan2(y1 - y0, x1 - x0);
    if (remaining <= length) return { x: x0 + ((x1 - x0) * remaining) / length, y: y0 + ((y1 - y0) * remaining) / length, angle };
    remaining -= length;
    x = x1;
    y = y1;
  }
  return { x, y, angle };
}
