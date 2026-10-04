import { describe, expect, it } from "vitest";
import { isSlug, parseSnippetId, parseUserId } from "./ids";

describe("parseUserId", () => {
  it("accepts a 24-hex ObjectId string", () => {
    expect(parseUserId("0".repeat(24))).toBe("0".repeat(24));
    expect(parseUserId("507f1f77bcf86cd799439011")).toBe("507f1f77bcf86cd799439011");
  });

  it("rejects operator objects, short strings and wrong lengths", () => {
    expect(parseUserId({ $ne: null })).toBeNull();
    expect(parseUserId("x")).toBeNull();
    expect(parseUserId("0".repeat(23))).toBeNull();
    expect(parseUserId("0".repeat(25))).toBeNull();
    expect(parseUserId("g".repeat(24))).toBeNull();
    expect(parseUserId(undefined)).toBeNull();
    expect(parseUserId(12)).toBeNull();
  });
});

describe("parseSnippetId", () => {
  it("accepts a 24-hex string and rejects everything else", () => {
    expect(parseSnippetId("a".repeat(24))).toBe("a".repeat(24));
    expect(parseSnippetId({ $gt: "" })).toBeNull();
    expect(parseSnippetId("")).toBeNull();
  });
});

describe("isSlug", () => {
  it("accepts exactly 10 url-safe characters", () => {
    expect(isSlug("abcdefghij")).toBe(true);
    expect(isSlug("A_b-C1d2E3")).toBe(true);
  });

  it("rejects other lengths, bad characters and non-strings", () => {
    expect(isSlug("abc")).toBe(false);
    expect(isSlug("abcdefghijk")).toBe(false);
    expect(isSlug("abcdefghi!")).toBe(false);
    expect(isSlug({ $gt: "" })).toBe(false);
    expect(isSlug(null)).toBe(false);
  });
});
