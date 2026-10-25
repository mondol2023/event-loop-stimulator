import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { docsHref } from "./docsHref";

const base: Diagnostic = { code: "E_EXCLUDED_API", message: "m", range: { start: 0, end: 1 }, hint: "h" };

describe("docsHref", () => {
  it("anchors on the code when the diagnostic has docs", () => {
    expect(docsHref({ ...base, docs: "docs/SUPPORTED_SUBSET.md" })).toBe("/docs/subset#E_EXCLUDED_API");
  });
  it("links the page when it has none", () => {
    expect(docsHref(base)).toBe("/docs/subset");
  });
});
