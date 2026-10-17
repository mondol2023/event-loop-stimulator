import { describe, expect, it } from "vitest";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { HeapObject } from "../objects/HeapObject";
import { Heap, HEAP_OBJECT_LIMIT } from "./Heap";

class Dummy extends HeapObject {}

describe("Heap", () => {
  it("assigns ids sequentially from 1", () => {
    const heap = new Heap();
    const a = heap.allocate((id) => new Dummy(id));
    const b = heap.allocate((id) => new Dummy(id));
    expect([a.id, b.id]).toEqual([1, 2]);
    expect(heap.allocatedCount).toBe(2);
  });

  it("allows 1,024 allocations and halts on the 1,025th", () => {
    const heap = new Heap();
    for (let i = 0; i < HEAP_OBJECT_LIMIT; i++) heap.allocate((id) => new Dummy(id));
    expect(heap.allocatedCount).toBe(1024);
    let halt: unknown;
    try {
      heap.allocate((id) => new Dummy(id));
    } catch (e) {
      halt = e;
    }
    expect(halt).toBeInstanceOf(SimulationHalt);
    expect((halt as SimulationHalt).stop).toEqual({ kind: "limit", limit: "heapObjects" });
    expect(heap.allocatedCount).toBe(1024);
  });
});
