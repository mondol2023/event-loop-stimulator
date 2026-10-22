import type { HeapObject } from "../objects/HeapObject";

// The modeled old generation. `limitBytes` is the size at which a mark-compact runs; a
// mark-compact that finds more live data than the limit raises it, as V8 grows its heap limit.

export class OldGen {
  readonly baseLimitBytes: number;
  limitBytes: number;
  readonly #residents = new Map<HeapObject, number>();
  #used = 0;

  constructor(limitBytes: number) {
    this.baseLimitBytes = limitBytes;
    this.limitBytes = limitBytes;
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

  objects(): HeapObject[] {
    return [...this.#residents.keys()];
  }

  sizeOf(object: HeapObject): number {
    return this.#residents.get(object) ?? 0;
  }

  add(object: HeapObject, size: number): void {
    this.#residents.set(object, size);
    this.#used += size;
  }

  remove(object: HeapObject): void {
    const size = this.#residents.get(object);
    if (size === undefined) return;
    this.#residents.delete(object);
    this.#used -= size;
  }
}
