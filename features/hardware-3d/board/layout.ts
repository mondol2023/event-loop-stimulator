import type { MemRegion } from "@/core/hardware/classifyInstruction";

// Board units; x is right, y is up, z is height off the substrate. Both compositions are authored by hand, and nothing here depends on a tick.

export type Vec2 = readonly [number, number];
/** A rectangle by centre and size. */
export type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
/** Cell centres in row-major order, all cells `cell` wide. */
export type Grid = { readonly cell: number; readonly positions: readonly Vec2[] };
export type Composition = "wide" | "tall";

export type BoardLayout = {
  readonly composition: Composition;
  readonly size: Vec2;
  readonly substrate: Rect;
  readonly die: Rect;
  readonly ramModule: Rect;
  readonly alu: Rect;
  /** In encoding order: rax rcx rdx rbx rsp rbp rsi rdi r8 to r15. */
  readonly registers: readonly Rect[];
  readonly l1: Grid;
  readonly l2: Grid;
  readonly ram: Readonly<Record<MemRegion, Grid>>;
  readonly labels: {
    readonly die: Vec2;
    readonly ram: Vec2;
    readonly registers: Vec2;
    readonly l1: Vec2;
    readonly l2: Vec2;
    readonly legend: Vec2;
    readonly regions: Readonly<Record<MemRegion, Vec2>>;
  };
  /** Polylines inside the die: bank to ALU to L1 to L2 to the bus port. */
  readonly internalBus: readonly (readonly Vec2[])[];
  /** From the die's bus port to the entry of each region; a write travels this way, a fetch or read the other. */
  readonly memoryBus: Readonly<Record<MemRegion, readonly Vec2[]>>;
};

/** Cells in the one RAM InstancedMesh: stack, young and old are 8 x 8 each, and the code strip is 16. */
export const REGION_CELLS: Readonly<Record<MemRegion, number>> = { stack: 64, young: 64, old: 64, code: 16 };
export const REGION_OFFSET: Readonly<Record<MemRegion, number>> = { stack: 0, young: 64, old: 128, code: 192 };
export const RAM_CELL_COUNT = 208;

/** `left`/`top` bound the first cell; `step` is the pitch and `cell` the drawn size. */
function grid(left: number, top: number, cols: number, rows: number, step: number, cell: number): Grid {
  const positions: Vec2[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) positions.push([left + cell / 2 + c * step, top - cell / 2 - r * step]);
  return { cell, positions };
}

function registerTiles(left: number, top: number, cols: number, w: number, h: number, stepX: number, stepY: number): Rect[] {
  return Array.from({ length: 16 }, (_, i) => ({ x: left + w / 2 + (i % cols) * stepX, y: top - h / 2 - Math.floor(i / cols) * stepY, w, h }));
}

const RAM_STEP = 0.65;
const RAM_CELL = 0.55;

function wide(): BoardLayout {
  const cx = (g: Grid, from: number, to: number): number => ((g.positions[from]?.[0] ?? 0) + (g.positions[to]?.[0] ?? 0)) / 2;
  const code = grid(5.4, 2.6, 2, 8, RAM_STEP, RAM_CELL);
  const stack = grid(7.4, 2.6, 8, 8, RAM_STEP, RAM_CELL);
  const young = grid(13.2, 2.6, 8, 8, RAM_STEP, RAM_CELL);
  const old = grid(19.0, 2.6, 8, 8, RAM_STEP, RAM_CELL);
  const port: Vec2 = [0.75, -4.7];
  const entry = (x: number): Vec2[] => [port, [3.0, -4.7], [3.0, -3.5], [x, -3.5], [x, -2.6]];
  return {
    composition: "wide",
    size: [50.4, 15.5],
    substrate: { x: 0, y: 0, w: 50.4, h: 15.5 },
    die: { x: -11.875, y: 0, w: 25.25, h: 14.5 },
    ramModule: { x: 14.7, y: 0, w: 19.6, h: 14.5 },
    alu: { x: -21, y: -3.5, w: 5, h: 3.4 },
    registers: registerTiles(-24, 6.6, 8, 1.75, 2.5, 1.85, 2.7),
    l1: grid(-17, -2.4, 4, 2, 1.4, 1.2),
    l2: grid(-9.8, -2.4, 8, 4, 1.2, 1),
    ram: { code, stack, young, old },
    labels: {
      die: [-4.4, 4.2],
      ram: [14.7, 6.8],
      registers: [-16.6, 6.95],
      l1: [-14.3, -1.7],
      l2: [-5.1, -1.7],
      legend: [14.7, -5.9],
      regions: { code: [6.0, 3.3], stack: [10.0, 3.3], young: [15.8, 3.3], old: [21.6, 3.3] },
    },
    internalBus: [
      [[-21, 1.4], [-21, -1.8]],
      [[-18.5, -3.5], [-17, -3.5]],
      [[-11.6, -3.7], [-9.8, -3.7]],
      [[-0.4, -4.7], port],
    ],
    memoryBus: { code: entry(cx(code, 0, 1)), stack: entry(cx(stack, 0, 7)), young: entry(cx(young, 0, 7)), old: entry(cx(old, 0, 7)) },
  };
}

function tall(): BoardLayout {
  const code = grid(-8.4, -6.4, 8, 2, RAM_STEP, RAM_CELL);
  const stack = grid(3.2, -6.4, 8, 8, RAM_STEP, RAM_CELL);
  const young = grid(-8.4, -13.0, 8, 8, RAM_STEP, RAM_CELL);
  const old = grid(3.2, -13.0, 8, 8, RAM_STEP, RAM_CELL);
  const port: Vec2 = [8.5, 1.5];
  const via = (end: Vec2): Vec2[] => [port, [8.5, -3], [0, -3], [0, end[1]], end];
  return {
    composition: "tall",
    size: [24, 38.5],
    substrate: { x: 0, y: 0, w: 24, h: 38.5 },
    die: { x: 0, y: 10, w: 23, h: 17 },
    ramModule: { x: 0, y: -11.5, w: 23, h: 14 },
    alu: { x: -6.5, y: 5.6, w: 5, h: 3 },
    registers: registerTiles(-11, 17.6, 4, 2.5, 2.2, 2.62, 2.42),
    l1: grid(1, 16.6, 4, 2, 1.4, 1.2),
    l2: grid(1, 12.4, 8, 4, 1.2, 1),
    ram: { code, stack, young, old },
    labels: {
      die: [-4, 2.7],
      ram: [-9.2, -4.95],
      registers: [-6, 18.1],
      l1: [3.7, 17.3],
      l2: [5.2, 12.9],
      legend: [-3, -1],
      regions: { code: [-5.8, -5.85], stack: [5.8, -5.85], young: [-5.8, -12.45], old: [5.8, -12.45] },
    },
    internalBus: [
      [[-6.5, 8.14], [-6.5, 7.1]],
      [[-4, 5.6], [0.4, 5.6], [0.4, 15.3], [1, 15.3]],
      [[6.4, 15.3], [10.8, 15.3], [10.8, 10.9], [10.4, 10.9]],
      [[8.5, 7.8], port],
    ],
    memoryBus: { code: via([-3.2, -7.05]), stack: via([3.2, -9]), young: via([-3.2, -15.6]), old: via([3.2, -15.6]) },
  };
}

export function boardLayout(composition: Composition): BoardLayout {
  switch (composition) {
    case "wide":
      return wide();
    case "tall":
      return tall();
    default: {
      const never: never = composition;
      return never;
    }
  }
}

/** Container aspect (width / height) at or above this uses the wide composition (design brief section 10). */
export const WIDE_ASPECT = 1.6;

export function compositionFor(aspect: number): Composition {
  return aspect >= WIDE_ASPECT ? "wide" : "tall";
}
