import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("reduced motion in the global stylesheet", () => {
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

  it("switches every CSS transition and animation off", () => {
    expect(block).toMatch(/transition:\s*none\s*!important/);
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });

  it("applies to every element and its pseudo-elements", () => {
    expect(block).toMatch(/\*,\s*::before,\s*::after/);
  });
});
