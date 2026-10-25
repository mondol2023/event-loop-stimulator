import { z } from "@/core/shared/zod";
import type { PlaybackSpeed } from "@/features/playground/store/playgroundStore";

export type Theme = "dark" | "light";
export type UsageMode = "self-study" | "interview" | "classroom";

export const PREFS_COOKIES = { theme: "sl_theme", mode: "sl_mode" } as const;

const ThemeSchema = z.enum(["dark", "light"]);
const ModeSchema = z.enum(["self-study", "interview", "classroom"]);

export type Prefs = { theme: Theme; mode: UsageMode; themeExplicit: boolean };

/** Cookie values are untrusted input: anything invalid falls back to the default. */
export function parsePrefs(cookies: { theme?: string | undefined; mode?: string | undefined }): Prefs {
  const theme = ThemeSchema.safeParse(cookies.theme);
  const mode = ModeSchema.safeParse(cookies.mode);
  const resolvedMode: UsageMode = mode.success ? mode.data : "self-study";
  // Classroom projectors want light, but only until the user picks a theme themselves.
  const resolvedTheme: Theme = theme.success ? theme.data : resolvedMode === "classroom" ? "light" : "dark";
  return { theme: resolvedTheme, mode: resolvedMode, themeExplicit: theme.success };
}

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
