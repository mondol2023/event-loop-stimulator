import type { GcEvent, HeapRegion, V8Snapshot } from "@/core/timeline/Tick";

function filled(used: number, capacity: number, cells: number): number {
  if (capacity <= 0 || used <= 0) return 0;
  return Math.min(cells, Math.round((used / capacity) * cells));
}

// Illustrative: `from` is the young generation's fill; `to` is the share of the last scavenge's collected objects that survived (0 otherwise).
export function heapStrip(heap: V8Snapshot["heap"], cells = 64): { young: { from: number; to: number }; old: number; lastGc: GcEvent | null } {
  const young: HeapRegion = heap.young;
  const lastGc = heap.lastGc ?? null;
  let to = 0;
  if (lastGc && lastGc.type === "scavenge") {
    const seen = lastGc.survivedObjects + lastGc.freedObjects + lastGc.promotedObjects;
    if (seen > 0) to = Math.min(cells, Math.round((lastGc.survivedObjects / seen) * cells));
  }
  return { young: { from: filled(young.usedBytes, young.capacityBytes, cells), to }, old: filled(heap.old.usedBytes, heap.old.capacityBytes, cells), lastGc };
}
