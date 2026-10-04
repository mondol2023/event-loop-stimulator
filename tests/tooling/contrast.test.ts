import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WCAG 2.2 AA (PROMPT.md §8.1): text ≥ 4.5:1 in both themes. Parses the real
// tokens from app/globals.css so a palette edit can't silently regress.
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function tokens(selector: string): Map<string, string> {
  const start = css.search(new RegExp(`^${selector.replace(".", "\\.")} \\{`, "m"));
  const block = start < 0 ? undefined : css.slice(start, css.indexOf("\n}", start));
  if (!block) throw new Error(`no ${selector} block in globals.css`);
  return new Map([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1]!, m[2]!]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const light = tokens(":root");
const themes = { light, dark: new Map([...light, ...tokens(".dark")]) };

const SURFACES = ["background", "panel", "card"];
const TEXT_ON_SURFACES = ["foreground", "muted-foreground", "primary", "microtask", "macrotask", "webapi", "destructive", "warning"];
const PAIRS: [string, string][] = [
  ...SURFACES.flatMap((s) => TEXT_ON_SURFACES.map((t): [string, string] => [t, s])),
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["muted-foreground", "muted"],
  ["accent-foreground", "accent"],
  ["popover-foreground", "popover"],
];

describe.each(Object.entries(themes))("%s theme", (_name, t) => {
  it.each(PAIRS)("%s on %s ≥ 4.5:1", (fg, bg) => {
    const [f, b] = [t.get(fg), t.get(bg)];
    expect(f, fg).toBeDefined();
    expect(b, bg).toBeDefined();
    expect(contrast(f!, b!)).toBeGreaterThanOrEqual(4.5);
  });
});
