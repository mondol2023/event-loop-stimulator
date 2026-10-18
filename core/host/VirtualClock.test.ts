import { describe, expect, it } from "vitest";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { VIRTUAL_TIME_LIMIT_MS, VirtualClock } from "./VirtualClock";

describe("VirtualClock", () => {
  it("starts at 0 and only moves when the loop advances it (JS costs 0 virtual ms)", () => {
    const clock = new VirtualClock();
    expect(clock.now()).toBe(0);
    clock.advanceTo(5);
    expect(clock.now()).toBe(5);
    clock.advanceTo(5);
    expect(clock.now()).toBe(5);
  });

  it("never moves backwards", () => {
    const clock = new VirtualClock();
    clock.advanceTo(10);
    expect(() => clock.advanceTo(9)).toThrow(/backwards/);
  });

  it("stops at the virtual-time limit with a limit halt, never a JS error", () => {
    const clock = new VirtualClock();
    clock.advanceTo(VIRTUAL_TIME_LIMIT_MS);
    const halt = (() => {
      try {
        clock.advanceTo(VIRTUAL_TIME_LIMIT_MS + 1);
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(halt).toBeInstanceOf(SimulationHalt);
    expect((halt as SimulationHalt).stop).toEqual({ kind: "limit", limit: "virtualTime" });
  });
});
