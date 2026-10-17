import { describe, expect, it } from "vitest";
import { formatMessage } from "./messages";

// Texts as the pinned V8 prints them (each one appears in a recorded fixture or was probed).

describe("formatMessage", () => {
  it("substitutes each % with the next argument, in order", () => {
    expect(formatMessage("kNonObjectPropertyLoadWithProperty", "undefined", "x")).toBe(
      "Cannot read properties of undefined (reading 'x')",
    );
    expect(formatMessage("kNonObjectPropertyStoreWithProperty", "null", "x")).toBe(
      "Cannot set properties of null (setting 'x')",
    );
    expect(formatMessage("kNotDefined", "missingVariable")).toBe("missingVariable is not defined");
    expect(formatMessage("kAccessedUninitializedVariable", "y")).toBe("Cannot access 'y' before initialization");
    expect(formatMessage("kCalledNonCallable", "point.describe")).toBe("point.describe is not a function");
    expect(formatMessage("kPromiseCyclic", "#<Promise>")).toBe("Chaining cycle detected for promise #<Promise>");
  });

  it("returns argument-free templates as they are", () => {
    expect(formatMessage("kConstAssign")).toBe("Assignment to constant variable.");
    expect(formatMessage("kInvalidArrayLength")).toBe("Invalid array length");
    expect(formatMessage("kReduceNoInitial")).toBe("Reduce of empty array with no initial value");
    expect(formatMessage("kAllPromisesRejected")).toBe("All promises were rejected");
  });

  it("does not re-substitute a % that an argument brings in", () => {
    expect(formatMessage("kNonObjectPropertyLoadWithProperty", "undefined", "100%")).toBe(
      "Cannot read properties of undefined (reading '100%')",
    );
  });

  it("rejects a wrong argument count (a programmer error)", () => {
    expect(() => formatMessage("kNotDefined")).toThrow(/expects 1/);
    expect(() => formatMessage("kConstAssign", "x")).toThrow(/expects 0/);
  });
});
