import type { ObjectId } from "@/core/shared/ids";

/** Base of everything the simulated V8 heap allocates. Created only through `Heap.allocate`. */
export abstract class HeapObject {
  readonly id: ObjectId;

  constructor(id: ObjectId) {
    this.id = id;
  }
}
