import type { PlaybackSpeed } from "@/features/playground/store/playgroundStore";

// The preference vocabulary that client code needs. It stays free of Zod (which parsePrefs in prefs.ts
// pulls in) so the root layout's client provider and the playground do not ship Zod to the browser.

export type Theme = "dark" | "light";
export type UsageMode = "self-study" | "interview" | "classroom";

export const PREFS_COOKIES = { theme: "sl_theme", mode: "sl_mode" } as const;

export type Prefs = { theme: Theme; mode: UsageMode; themeExplicit: boolean };

/** Per-mode playback defaults (D3). */
export function modeDefaults(mode: UsageMode): { speed: PlaybackSpeed; predictFirst: boolean } {
  switch (mode) {
    case "interview":
      return { speed: 2, predictFirst: true };
    case "classroom":
      return { speed: 0.5, predictFirst: false };
    case "self-study":
      return { speed: 1, predictFirst: false };
  }
}
