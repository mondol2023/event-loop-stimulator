import { describe, expect, it } from "vitest";
import { FEEDBACK_SLOT_SIZE, FeedbackVectorSpec } from "./FeedbackVectorSpec";

describe("FeedbackVectorSpec", () => {
  it("starts at slot 0", () => {
    expect(new FeedbackVectorSpec().addSlot("binary-op")).toBe(0);
  });

  it("advances by the slot count of each kind", () => {
    // The slot operands of the main function of the closure-counter fixture, in order:
    // CallUndefinedReceiver1 [0], [2]; LdaGlobal [4]; GetNamedProperty [6], [8]; CallProperty0 [10].
    const spec = new FeedbackVectorSpec();
    expect(spec.addSlot("call")).toBe(0);
    expect(spec.addSlot("call")).toBe(2);
    expect(spec.addSlot("global-load")).toBe(4);
    expect(spec.addSlot("load")).toBe(6);
    expect(spec.addSlot("load")).toBe(8);
    expect(spec.addSlot("call")).toBe(10);
    expect(spec.slotCount).toBe(12);
  });

  it("gives binary operations, comparisons, literals and closure cells one slot", () => {
    // `Add r0, [0]`, `Add r0, [1]`, `TestEqualStrict a0, [6]` followed by a call at [7],
    // CreateObjectLiteral [22] followed by DefineNamedOwnProperty [23], CreateClosure [0]..[3].
    const spec = new FeedbackVectorSpec();
    expect(spec.addSlot("binary-op")).toBe(0);
    expect(spec.addSlot("binary-op")).toBe(1);
    expect(spec.addSlot("compare")).toBe(2);
    expect(spec.addSlot("literal")).toBe(3);
    expect(spec.addSlot("closure-cell")).toBe(4);
    expect(spec.addSlot("store")).toBe(5);
    expect(spec.addSlot("global-store")).toBe(7);
    expect(spec.slotCount).toBe(9);
  });

  it("exposes the table it counts with", () => {
    expect(FEEDBACK_SLOT_SIZE).toMatchObject({ load: 2, store: 2, call: 2, "global-load": 2, "global-store": 2, "binary-op": 1, compare: 1 });
  });
});
