import { describe, expect, it } from "vitest";
import type { ElementsKind } from "@/core/runtime/objects/ElementsKind";
import { TimelineStore } from "@/core/timeline/TimelineStore";
import { fixtureRun } from "@/features/playground/test/fixtureTimeline";
import { ElementsFocusTracker, latestChangedElements } from "./elementsFocus";

const at = (kinds: readonly Record<number, ElementsKind>[]) => (i: number) => ({ v8: { elementsKinds: kinds[i] ?? {} } });

describe("latestChangedElements", () => {
  const kinds: Record<number, ElementsKind>[] = [
    {},
    { 4: "PACKED_SMI_ELEMENTS" },
    { 4: "PACKED_SMI_ELEMENTS" },
    { 4: "PACKED_DOUBLE_ELEMENTS" },
    { 4: "PACKED_DOUBLE_ELEMENTS", 6: "PACKED_ELEMENTS" },
    { 4: "PACKED_DOUBLE_ELEMENTS", 6: "PACKED_ELEMENTS" },
  ];

  it("is null while no object has an elements kind", () => {
    expect(latestChangedElements(at(kinds), 0)).toBeNull();
  });

  it("finds an array the moment it appears", () => {
    expect(latestChangedElements(at(kinds), 1)).toEqual({ objectId: 4, kind: "PACKED_SMI_ELEMENTS" });
  });

  it("keeps the last change while later ticks change nothing", () => {
    expect(latestChangedElements(at(kinds), 2)).toEqual({ objectId: 4, kind: "PACKED_SMI_ELEMENTS" });
    expect(latestChangedElements(at(kinds), 3)).toEqual({ objectId: 4, kind: "PACKED_DOUBLE_ELEMENTS" });
  });

  it("moves to another array when that one changes later", () => {
    expect(latestChangedElements(at(kinds), 5)).toEqual({ objectId: 6, kind: "PACKED_ELEMENTS" });
  });
});

describe("ElementsFocusTracker", () => {
  const { simulated } = fixtureRun("elements-kinds-lattice");
  const timeline = TimelineStore.deserialize(simulated.timeline);
  const counted = () => {
    const counter = { calls: 0 };
    return { counter, at: (i: number) => (counter.calls++, timeline.at(i)) };
  };

  it("agrees with the full walk at every index, stepping forward", () => {
    const tracker = new ElementsFocusTracker();
    for (let i = 0; i < timeline.length; i++) expect(tracker.resolve(timeline, (n) => timeline.at(n), i)).toEqual(latestChangedElements((n) => timeline.at(n), i));
  });

  it("agrees after backward seeks and forward jumps", () => {
    const tracker = new ElementsFocusTracker();
    const last = timeline.length - 1;
    for (const i of [last, 3, 0, 10, 10, 2, last, 5, 20, 1]) {
      const index = Math.min(i, last);
      expect(tracker.resolve(timeline, (n) => timeline.at(n), index)).toEqual(latestChangedElements((n) => timeline.at(n), index));
    }
  });

  it("reads one tick per step when stepping forward", () => {
    const tracker = new ElementsFocusTracker();
    const { counter, at } = counted();
    tracker.resolve(timeline, at, 0);
    for (let i = 1; i < timeline.length; i++) {
      const before = counter.calls;
      tracker.resolve(timeline, at, i);
      expect(counter.calls - before).toBe(1);
    }
    const before = counter.calls;
    tracker.resolve(timeline, at, timeline.length - 1);
    expect(counter.calls).toBe(before);
  });

  it("starts over for a different timeline", () => {
    const tracker = new ElementsFocusTracker();
    tracker.resolve(timeline, (n) => timeline.at(n), timeline.length - 1);
    const other = {};
    expect(tracker.resolve(other, () => ({ v8: { elementsKinds: {} } }), 2)).toBeNull();
  });
});
