import type { MemRegion } from "@/core/hardware/classifyInstruction";
import type { Tick } from "@/core/timeline/Tick";
import { REGION_CELLS, REGION_OFFSET } from "./layout";

const filled = (used: number, capacity: number, cells: number): number => (capacity <= 0 || used <= 0 ? 0 : Math.min(cells, Math.round((used / capacity) * cells)));

/**
 * Illustrative: how many cells of each 64-cell RAM region show as used.
 * The stack counts a frame's saved words and registers as cells; young and old use the Heap strip's used/capacity ratio (features/hardware-3d may not import features/v8-internals).
 */
export function ramFill(tick: Tick): { stack: number; young: number; old: number } {
  const stackCells = tick.callStack.reduce((sum, frame) => sum + 2 + frame.registers.length, 0);
  const { heap } = tick.v8;
  return {
    stack: Math.min(REGION_CELLS.stack, stackCells),
    young: filled(heap.young.usedBytes, heap.young.capacityBytes, REGION_CELLS.young),
    old: filled(heap.old.usedBytes, heap.old.capacityBytes, REGION_CELLS.old),
  };
}

/** The RAM instance a cache line lands on: its tag, wrapped into the region, so the same line always lights the same cell. */
export function ramCell(region: MemRegion, tag: number): number {
  const cells = REGION_CELLS[region];
  return REGION_OFFSET[region] + (((tag % cells) + cells) % cells);
}
