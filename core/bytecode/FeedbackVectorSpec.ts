// The slots a function's FeedbackVector needs (V8's `FeedbackVectorSpec`). The bytecode names a
// slot by its first index, and a slot kind can span more than one index: the sizes below are the
// strides between the slot operands in the recorded listings.

export const FEEDBACK_SLOT_SIZE = {
  load: 2,
  store: 2,
  call: 2,
  "global-load": 2,
  "global-store": 2,
  "binary-op": 1,
  compare: 1,
  literal: 1,
  "closure-cell": 1,
} as const;

export type FeedbackSlotKind = keyof typeof FEEDBACK_SLOT_SIZE;

export class FeedbackVectorSpec {
  private count = 0;

  /** Slots allocated so far: the length of the vector. */
  get slotCount(): number {
    return this.count;
  }

  /** Allocates a slot of `kind` and returns the index of its first entry. */
  addSlot(kind: FeedbackSlotKind): number {
    const first = this.count;
    this.count += FEEDBACK_SLOT_SIZE[kind];
    return first;
  }
}
