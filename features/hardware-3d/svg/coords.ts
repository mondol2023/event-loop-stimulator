import type { BoardLayout, Rect, Vec2 } from "../board/layout";

/** Board units have y up and the origin at the centre; SVG has y down from the top-left corner. */
export type Mapper = {
  readonly x: (x: number) => number;
  readonly y: (y: number) => number;
  readonly point: (p: Vec2) => string;
  /** The SVG box of a rectangle given by centre and size. */
  readonly box: (r: Rect) => { x: number; y: number; width: number; height: number };
};

export function mapperFor(layout: BoardLayout): Mapper {
  const [w, h] = layout.size;
  const x = (bx: number): number => bx + w / 2;
  const y = (by: number): number => h / 2 - by;
  return {
    x,
    y,
    point: (p) => `${x(p[0])},${y(p[1])}`,
    box: (r) => ({ x: x(r.x - r.w / 2), y: y(r.y + r.h / 2), width: r.w, height: r.h }),
  };
}
