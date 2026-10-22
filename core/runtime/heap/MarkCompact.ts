import { estimatedSize } from "./estimatedSize";
import type { OldGen } from "./OldGen";

// A mark-compact (V8's full GC) over the old generation: what the roots no longer reach is freed
// and the rest is compacted in place. The limit grows when the live data is large, as V8's does.

export type MarkCompactResult = {
  freedObjects: number;
  freedBytes: number;
  survivedObjects: number;
  liveBytes: number;
};

/** The old limit after a collection: twice the live data, never below the configured base. */
const LIMIT_GROWTH = 2;

export function markCompact(old: OldGen, reachable: ReadonlySet<unknown>): MarkCompactResult {
  const result: MarkCompactResult = { freedObjects: 0, freedBytes: 0, survivedObjects: 0, liveBytes: 0 };
  for (const object of old.objects()) {
    if (reachable.has(object)) {
      result.survivedObjects += 1;
      result.liveBytes += estimatedSize(object);
    } else {
      result.freedObjects += 1;
      result.freedBytes += old.sizeOf(object);
      old.remove(object);
    }
  }
  old.limitBytes = Math.max(old.baseLimitBytes, result.liveBytes * LIMIT_GROWTH);
  return result;
}
