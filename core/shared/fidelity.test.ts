import { describe, expect, it } from "vitest";
import { TRUTH_TOOLTIPS, type TruthLevel } from "./fidelity";

describe("TRUTH_TOOLTIPS", () => {
  it("has exactly the four FIDELITY.md sentences", () => {
    const levels: TruthLevel[] = ["exact", "verified-model", "modeled", "illustrative"];
    expect(Object.keys(TRUTH_TOOLTIPS).sort()).toEqual([...levels].sort());
    expect(TRUTH_TOOLTIPS.exact).toBe("Exact: byte-identical to real Node on the pinned version.");
    expect(TRUTH_TOOLTIPS["verified-model"]).toBe(
      "Verified model: our reconstruction, checked against real V8 on test programs. Your program's details may differ.",
    );
    expect(TRUTH_TOOLTIPS.modeled).toBe(
      "Modeled: how V8 would typically behave; V8's heuristics change between versions.",
    );
    expect(TRUTH_TOOLTIPS.illustrative).toBe(
      "Illustrative: a teaching picture of the idea, not V8's actual output.",
    );
  });
});
