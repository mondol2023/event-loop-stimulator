import type { ObjectId } from "@/core/shared/ids";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import type { HeapObject } from "../objects/HeapObject";

/** Heap-object limit (§7.1). */
export const HEAP_OBJECT_LIMIT = 1024;

/**
 * Counts JS-visible allocations of the program (objects, arrays, closures, promises, errors,
 * generator objects). The count is cumulative, never live, so GC can never change whether the
 * limit hits. Contexts, strings, HeapNumbers and realm intrinsics are not allocated here.
 */
export class Heap {
  #count = 0;

  get allocatedCount(): number {
    return this.#count;
  }

  allocate<T extends HeapObject>(make: (id: ObjectId) => T): T {
    if (this.#count >= HEAP_OBJECT_LIMIT) {
      throw new SimulationHalt({ kind: "limit", limit: "heapObjects" });
    }
    this.#count += 1;
    return make(this.#count as ObjectId);
  }
}
