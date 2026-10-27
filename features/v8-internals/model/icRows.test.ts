import { describe, expect, it } from "vitest";
import type { FeedbackSnapshot } from "@/core/timeline/Tick";
import type { FunctionId } from "@/core/shared/ids";
import { icRows } from "./icRows";

const feedback = (kind: string, count: number): FeedbackSnapshot[] => [
  {
    functionId: 0 as FunctionId,
    functionName: "f",
    slots: Array.from({ length: count }, (_, index) => ({ index, kind, state: "MONOMORPHIC" as const, mapIds: [] })),
  },
];

describe("icRows", () => {
  it("limits 120 slots to 50 rows and reports the total", () => {
    const out = icRows(feedback("LoadProperty", 120));
    expect(out.rows).toHaveLength(50);
    expect(out.total).toBe(120);
  });

  it("marks verified kinds against the recorded ones", () => {
    expect(icRows(feedback("LoadProperty", 1)).rows[0]?.truth).toBe("verified-model");
    expect(icRows(feedback("DefineNamedOwn", 1)).rows[0]?.truth).toBe("modeled");
  });
});
