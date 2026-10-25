import { z } from "@/core/shared/zod";
import type { Prefs, Theme, UsageMode } from "./modes";

// Server-side parsing of the preference cookies. The shared vocabulary lives in modes.ts, which has no Zod.
export { modeDefaults, PREFS_COOKIES, type Prefs, type Theme, type UsageMode } from "./modes";

const ThemeSchema = z.enum(["dark", "light"]);
const ModeSchema = z.enum(["self-study", "interview", "classroom"]);

/** Cookie values are untrusted input: anything invalid falls back to the default. */
export function parsePrefs(cookies: { theme?: string | undefined; mode?: string | undefined }): Prefs {
  const theme = ThemeSchema.safeParse(cookies.theme);
  const mode = ModeSchema.safeParse(cookies.mode);
  const resolvedMode: UsageMode = mode.success ? mode.data : "self-study";
  // Classroom projectors want light, but only until the user picks a theme themselves.
  const resolvedTheme: Theme = theme.success ? theme.data : resolvedMode === "classroom" ? "light" : "dark";
  return { theme: resolvedTheme, mode: resolvedMode, themeExplicit: theme.success };
}
