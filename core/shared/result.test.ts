import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "./result";

describe("Result", () => {
  it("narrows on .ok for success", () => {
    const r: Result<number, string> = ok(3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(3);
    else throw new Error("expected ok");
  });

  it("narrows on .ok for failure", () => {
    const r: Result<number, string> = err("boom");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("boom");
    else throw new Error("expected err");
  });
});
