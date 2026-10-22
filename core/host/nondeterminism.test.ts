import { describe, expect, it } from "vitest";
import { NONDETERMINISM_RULES } from "./nondeterminism";

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
});
