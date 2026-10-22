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
    expect(formatMessage("kNotConstructor", "f")).toBe("f is not a constructor");
    expect(formatMessage("kNotGeneric", "Number.prototype.valueOf", "Number")).toBe("Number.prototype.valueOf requires that 'this' be a Number");
    expect(formatMessage("kStrictCannotCreateProperty", "x", "string", "abc")).toBe("Cannot create property 'x' on string 'abc'");
    expect(formatMessage("kStrictReadOnlyProperty", "length", "string", "abc")).toBe("Cannot assign to read only property 'length' of string 'abc'");
  });

  it("returns argument-free templates as they are", () => {
    expect(formatMessage("kConstAssign")).toBe("Assignment to constant variable.");
    expect(formatMessage("kInvalidArrayLength")).toBe("Invalid array length");
    expect(formatMessage("kReduceNoInitial")).toBe("Reduce of empty array with no initial value");
    expect(formatMessage("kAllPromisesRejected")).toBe("All promises were rejected");
    expect(formatMessage("kFunctionBind")).toBe("Bind must be called on a function");
    expect(formatMessage("kPromiseNonCallable")).toBe("Promise resolve or reject function is not callable");
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
