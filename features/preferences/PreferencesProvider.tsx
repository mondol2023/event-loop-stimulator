"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { PlaygroundStoreContext } from "@/features/playground/store/PlaygroundContext";
import { PREFS_COOKIES, modeDefaults, type Prefs, type Theme, type UsageMode } from "./prefs";

export type PreferencesValue = {
  theme: Theme;
  mode: UsageMode;
  setTheme(theme: Theme): void;
  setMode(mode: UsageMode): void;
};

export const PreferencesContext = createContext<PreferencesValue | null>(null);

function writeCookie(name: string, value: string): void {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax${secure}`;
}

function applyClasses(theme: Theme, mode: UsageMode): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("mode-classroom", mode === "classroom");
}

export function PreferencesProvider({ initial, children }: { initial: Prefs; children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initial.theme);
  const [mode, setModeState] = useState<UsageMode>(initial.mode);
  const [themeExplicit, setThemeExplicit] = useState(initial.themeExplicit);
  // Optional: preferences also live outside a playground, where there is no speed to reset.
  const store = useContext(PlaygroundStoreContext);

  const setTheme = useCallback(
    (next: Theme) => {
      writeCookie(PREFS_COOKIES.theme, next);
      setThemeState(next);
      setThemeExplicit(true);
      applyClasses(next, mode);
    },
    [mode],
  );

  const setMode = useCallback(
    (next: UsageMode) => {
      writeCookie(PREFS_COOKIES.mode, next);
      // Same rule the server applies: classroom flips to light unless the user chose a theme.
      const nextTheme: Theme = themeExplicit ? theme : next === "classroom" ? "light" : "dark";
      setModeState(next);
      setThemeState(nextTheme);
      applyClasses(nextTheme, next);
      store?.getState().setSpeed(modeDefaults(next).speed);
    },
    [store, theme, themeExplicit],
  );

  const value = useMemo(() => ({ theme, mode, setTheme, setMode }), [theme, mode, setTheme, setMode]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
