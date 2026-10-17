import { describe, expect, it } from "vitest";
import { isThrow, normal, thrown } from "./Completion";

describe("Completion", () => {
  it("distinguishes normal from throw completions", () => {
    expect(normal(1)).toEqual({ type: "normal", value: 1 });
    expect(thrown("e")).toEqual({ type: "throw", value: "e" });
    expect(isThrow(thrown(undefined))).toBe(true);
    expect(isThrow(normal(undefined))).toBe(false);
  });
});
