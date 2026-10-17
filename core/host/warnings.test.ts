import { describe, expect, it } from "vitest";
import { ProcessWarnings, timeoutOverflowWarning } from "./warnings";

// The recorded texts are checked against `timer-overflow-warning` in
// tests/conformance/error-printer-fixtures.test.ts; these cases pin the once-per-process rule.
describe("ProcessWarnings", () => {
  it("adds the --trace-warnings hint after the first warning only", () => {
    const w = new ProcessWarnings();
    expect(w.emit({ name: "W", message: "one" })).toBe(
      "(node:PID) W: one\n(Use `node --trace-warnings ...` to show where the warning was created)\n",
    );
    expect(w.emit({ name: "W", message: "two" })).toBe("(node:PID) W: two\n");
  });

  it("keeps the hint state per process", () => {
    expect(new ProcessWarnings().emit({ name: "W", message: "x" })).toContain("--trace-warnings");
  });
});

describe("timeoutOverflowWarning (lib/internal/timers.js)", () => {
  it("names the delay with Number::toString and says it was set to 1", () => {
    expect(timeoutOverflowWarning(2 ** 31)).toEqual({
      name: "TimeoutOverflowWarning",
      message: "2147483648 does not fit into a 32-bit signed integer.\nTimeout duration was set to 1.",
    });
    expect(timeoutOverflowWarning(1e21).message.startsWith("1e+21 does not fit")).toBe(true);
  });
});
