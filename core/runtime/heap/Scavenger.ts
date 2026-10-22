import type { HeapObject } from "../objects/HeapObject";
import { estimatedSize } from "./estimatedSize";
import type { OldGen } from "./OldGen";
import type { YoungGen } from "./YoungGen";

// A scavenge (V8's Scavenger): the live young objects are copied to the other semi-space and age
// by one; an object that has now survived two scavenges moves to the old generation, and so do
// the oldest survivors when the rest would not fit in a semi-space.

/** Survived scavenges after which an object is promoted. */
export const PROMOTION_AGE = 2;

export type ScavengeResult = {
  freedObjects: number;
  freedBytes: number;
  survivedObjects: number;
  promotedObjects: number;
  /** Bytes copied (survivors that stayed plus promoted ones): what the duration depends on. */
  copiedBytes: number;
};

export function scavenge(young: YoungGen, old: OldGen, reachable: ReadonlySet<unknown>): ScavengeResult {
  const result: ScavengeResult = { freedObjects: 0, freedBytes: 0, survivedObjects: 0, promotedObjects: 0, copiedBytes: 0 };
  const promote = (object: HeapObject, size: number, resident: Parameters<YoungGen["remove"]>[0]): void => {
    young.remove(resident);
    old.add(object, size);
    result.promotedObjects += 1;
  };
  for (const resident of young.residents()) {
    if (!reachable.has(resident.object)) {
      young.remove(resident);
      result.freedObjects += 1;
      result.freedBytes += resident.size;
      continue;
    }
    young.resize(resident, estimatedSize(resident.object));
    resident.survived += 1;
    result.copiedBytes += resident.size;
    if (resident.survived >= PROMOTION_AGE) promote(resident.object, resident.size, resident);
    else result.survivedObjects += 1;
  }
  // What stayed must fit in a semi-space: promote the oldest survivors until it does.
  for (const resident of young.residents()) {
    if (young.usedBytes <= young.capacityBytes) break;
    promote(resident.object, resident.size, resident);
    result.survivedObjects -= 1;
  }
  return result;
}
