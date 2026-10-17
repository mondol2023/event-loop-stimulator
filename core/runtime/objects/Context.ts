import type { RegisterValue } from "../values/JSValue";

/** `Context::MIN_CONTEXT_SLOTS` (src/objects/contexts.h): scope info and previous come before the variables. */
export const MIN_CONTEXT_SLOTS = 2;

/**
 * V8's Context: the slots of one scope that closures share, and the scope outside it. Contexts
 * are not JS-visible allocations, so they do not count toward the heap-object limit (Heap).
 * Slot operands are absolute indexes (variables start at MIN_CONTEXT_SLOTS). A block context's
 * size is not in the bytecode, so its slots grow on first store.
 */
export class Context {
  readonly parent: Context | null;
  readonly slots: RegisterValue[];

  constructor(parent: Context | null, slotCount: number) {
    this.parent = parent;
    this.slots = new Array<RegisterValue>(slotCount).fill(undefined);
  }

  load(index: number): RegisterValue {
    return this.slots[index - MIN_CONTEXT_SLOTS];
  }

  store(index: number, value: RegisterValue): void {
    const at = index - MIN_CONTEXT_SLOTS;
    while (this.slots.length < at) this.slots.push(undefined);
    this.slots[at] = value;
  }

  /** The context `depth` hops up the `previous` chain. */
  ancestor(depth: number): Context {
    if (depth === 0) return this;
    if (!this.parent) throw new Error(`context chain is shorter than ${depth}`);
    return this.parent.ancestor(depth - 1);
  }
}
