import { describe, expect, it } from "vitest";
import { TheHole, isTheHole } from "./TheHole";

describe("TheHole", () => {
  it("is a singleton distinct from undefined", () => {
    expect(isTheHole(TheHole)).toBe(true);
    expect(isTheHole(undefined)).toBe(false);
    expect(isTheHole(null)).toBe(false);
  });
});
