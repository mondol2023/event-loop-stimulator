import type { CacheLevel } from "@/core/hardware/cacheModel";

export type CacheFlash = "hit" | "miss";

/** Which cache cells flash for an access that `level` answered, and whether the RAM cell lights too (a miss in both caches). */
export function servedFlash(level: CacheLevel | null): { l1: CacheFlash | null; l2: CacheFlash | null; ram: boolean } {
  switch (level) {
    case null:
      return { l1: null, l2: null, ram: false };
    case "l1":
      return { l1: "hit", l2: null, ram: false };
    case "l2":
      return { l1: null, l2: "hit", ram: false };
    case "ram":
      return { l1: "miss", l2: "miss", ram: true };
    default: {
      const never: never = level;
      return never;
    }
  }
}
