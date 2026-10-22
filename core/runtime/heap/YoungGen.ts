import type { HeapObject } from "../objects/HeapObject";

// The modeled young generation (V8's new space): two semi-spaces of which one holds the live
// objects between scavenges. Illustrative: it counts bytes and ages, it moves nothing.

export interface Resident {
  readonly object: HeapObject;
  size: number;
  /** How many scavenges the object has survived. */
  survived: number;
}

export class YoungGen {
  /** The size of one semi-space. */
  readonly capacityBytes: number;
  readonly #residents = new Map<HeapObject, Resident>();
  #used = 0;

  constructor(capacityBytes: number) {
    this.capacityBytes = capacityBytes;
  }

  get usedBytes(): number {
    return this.#used;
  }

  get objectCount(): number {
    return this.#residents.size;
  }

  has(object: HeapObject): boolean {
    return this.#residents.has(object);
  }

  /** The residents in allocation order (the oldest first). */
  residents(): Resident[] {
    return [...this.#residents.values()];
  }

  add(object: HeapObject, size: number): void {
    this.#residents.set(object, { object, size, survived: 0 });
    this.#used += size;
  }

  resize(resident: Resident, size: number): void {
    this.#used += size - resident.size;
    resident.size = size;
  }

  remove(resident: Resident): void {
    if (this.#residents.delete(resident.object)) this.#used -= resident.size;
  }
}
