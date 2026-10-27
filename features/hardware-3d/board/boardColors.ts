import { Color } from "three";

// The board paints only with design tokens, read from the page so the light and dark themes both work.
const TOKEN_VARS = {
  background: "--background",
  panel: "--panel",
  card: "--card",
  secondary: "--secondary",
  border: "--border",
  foreground: "--foreground",
  mutedForeground: "--muted-foreground",
  current: "--primary",
  destructive: "--destructive",
  busRead: "--bus-read",
  busWrite: "--bus-write",
} as const;

export type ColorToken = keyof typeof TOKEN_VARS;
export type BoardColors = Readonly<Record<ColorToken, Color>>;

// The dark theme's values, used only where a stylesheet is absent (tests); a token the page does set always wins.
const FALLBACK: Readonly<Record<ColorToken, string>> = {
  background: "#0b1120",
  panel: "#0f172a",
  card: "#151e33",
  secondary: "#1e293b",
  border: "#263247",
  foreground: "#f1f5f9",
  mutedForeground: "#94a3b8",
  current: "#22c55e",
  destructive: "#f87171",
  busRead: "#60a5fa",
  busWrite: "#f472b6",
};

// Minified CSS shortens #ffffff to #fff, so both spellings count.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Reads every token from `getComputedStyle(document.documentElement)`. */
export function boardColors(): BoardColors {
  const style = getComputedStyle(document.documentElement);
  const entries = (Object.keys(TOKEN_VARS) as ColorToken[]).map((token) => {
    const raw = style.getPropertyValue(TOKEN_VARS[token]).trim();
    return [token, new Color(HEX.test(raw) ? raw : FALLBACK[token])] as const;
  });
  return Object.fromEntries(entries) as Record<ColorToken, Color>;
}

/** Calls `onChange` with fresh colours whenever `<html>` changes its class (the theme switch). */
export function watchBoardColors(onChange: (colors: BoardColors) => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(() => onChange(boardColors()));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export type BoardTheme = {
  /** Mutated in place on a theme change, so a held reference is always current. */
  readonly colors: BoardColors;
  /** Schedules a frame (the canvas runs on demand while paused). */
  readonly invalidate: () => void;
  /** Runs `listener` after every theme change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Starts watching `<html>`; returns the stop. */
  connect(): () => void;
};

export function createBoardTheme(invalidate: () => void): BoardTheme {
  const colors = boardColors();
  const listeners = new Set<() => void>();
  return {
    colors,
    invalidate,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    connect() {
      return watchBoardColors((next) => {
        for (const token of Object.keys(TOKEN_VARS) as ColorToken[]) colors[token].copy(next[token]);
        for (const listener of listeners) listener();
        invalidate();
      });
    },
  };
}
