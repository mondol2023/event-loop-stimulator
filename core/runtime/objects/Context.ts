import type { RegisterValue } from "../values/JSValue";

/**
 * V8's Context: the slots of one scope that closures share, and the scope outside it. Contexts
 * are not JS-visible allocations, so they do not count toward the heap-object limit (Heap).
 */
export class Context {
  readonly parent: Context | null;
  readonly slots: RegisterValue[];

  constructor(parent: Context | null, slotCount: number) {
    this.parent = parent;
    this.slots = new Array<RegisterValue>(slotCount).fill(undefined);
  }
}
