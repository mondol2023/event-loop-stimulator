import { describe, expect, it } from "vitest";
import type { V8Snapshot } from "@/core/timeline/Tick";
import { heapStrip } from "./heapStrip";

const region = (used: number, capacity: number) => ({ objectCount: 0, usedBytes: used, capacityBytes: capacity });

describe("heapStrip", () => {
  it("fills cells in proportion to used bytes", () => {
    const out = heapStrip({ young: region(512, 1024), old: region(100, 100) }, 64);
    expect(out.young.from).toBe(32);
    expect(out.old).toBe(64);
    expect(out.lastGc).toBeNull();
  });

  it("survives an empty region and an overfull one", () => {
    const out = heapStrip({ young: region(5000, 1024), old: region(0, 0) });
    expect(out.young.from).toBe(64);
    expect(out.old).toBe(0);
  });

  it("puts a scavenge's survivors in the to-space", () => {
    const lastGc = {
      type: "scavenge",
      freedObjects: 3,
      freedBytes: 0,
      survivedObjects: 1,
      promotedObjects: 0,
      fromSpace: "0x1",
      toSpace: "0x2",
      durationMs: 1,
    } as unknown as NonNullable<V8Snapshot["heap"]["lastGc"]>;
    const out = heapStrip({ young: region(0, 1024), old: region(0, 10), lastGc }, 64);
    expect(out.young.to).toBe(16);
    expect(out.lastGc).toBe(lastGc);
  });
});
