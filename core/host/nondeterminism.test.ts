import { describe, expect, it } from "vitest";
import { NONDETERMINISM_RULES, NondeterminismWatch } from "./nondeterminism";
import { TimersList, type TimeoutRecord } from "./timers";

describe("nondeterminism rules", () => {
  it("has one rule per probed case, each naming the fixture that proves it", () => {
    expect(NONDETERMINISM_RULES.map((r) => r.fixture)).toEqual(["timeout-vs-immediate-main", "timer-in-timer-ordering", "timer-after-first-write"]);
  });

  it("every warning says the order is not guaranteed", () => {
    for (const rule of NONDETERMINISM_RULES) expect(rule.warning).toMatch(/^Order not guaranteed in real Node: /);
  });

  it("rule 1's text is the one the plan fixes", () => {
    expect(NONDETERMINISM_RULES[0]?.warning).toBe(
      "Order not guaranteed in real Node: whether the 1 ms timer is due before the first loop iteration depends on how long startup took.",
    );
  });

  describe("rule 3 (timer armed after a write)", () => {
    const pending = [{} as TimeoutRecord];
    const armed = (expiry: number, id: number, msecs: number): TimersList => {
      const list = new TimersList(expiry, id, msecs);
      list.timers.push(...pending);
      return list;
    };
    const run = (leadWrites: number, betweenWrites: number): readonly string[] => {
      const watch = new NondeterminismWatch();
      for (let i = 0; i < leadWrites; i++) watch.wrote();
      const early = armed(2, 1, 2);
      watch.timerInserted(early, 2, [early]);
      for (let i = 0; i < betweenWrites; i++) watch.wrote();
      const late = armed(1, 2, 1);
      watch.timerInserted(late, 1, [early, late]);
      return watch.warnings;
    };

    it("fires when a write happens between arming the two lists, however many writes came before", () => {
      expect(run(0, 1)).toHaveLength(1);
      expect(run(1, 1)).toHaveLength(1);
      expect(run(1, 4)).toHaveLength(1);
    });

    it("stays quiet when no write happened between arming them (probed stable)", () => {
      expect(run(0, 0)).toEqual([]);
      expect(run(1, 0)).toEqual([]);
    });
  });
});
