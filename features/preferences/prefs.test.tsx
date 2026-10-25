// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PREFS_COOKIES, modeDefaults, parsePrefs } from "./prefs";
import { PreferencesProvider } from "./PreferencesProvider";
import { usePreferences } from "./usePreferences";

describe("parsePrefs", () => {
  it("defaults to dark and self-study", () => {
    expect(parsePrefs({})).toEqual({ theme: "dark", mode: "self-study", themeExplicit: false });
  });
  it("defaults classroom to the light theme", () => {
    expect(parsePrefs({ mode: "classroom" })).toEqual({ theme: "light", mode: "classroom", themeExplicit: false });
  });
  it("keeps an explicit theme in classroom", () => {
    expect(parsePrefs({ mode: "classroom", theme: "dark" })).toEqual({ theme: "dark", mode: "classroom", themeExplicit: true });
  });
  it("falls back to the defaults on invalid values", () => {
    expect(parsePrefs({ theme: "<script>", mode: "x" })).toEqual({ theme: "dark", mode: "self-study", themeExplicit: false });
  });
});

describe("modeDefaults", () => {
  it("follows D3", () => {
    expect(modeDefaults("self-study")).toEqual({ speed: 1, predictFirst: false });
    expect(modeDefaults("interview")).toEqual({ speed: 2, predictFirst: true });
    expect(modeDefaults("classroom")).toEqual({ speed: 0.5, predictFirst: false });
  });
});

describe("usePreferences", () => {
  afterEach(() => {
    document.documentElement.className = "";
    document.cookie = "sl_theme=; max-age=0; path=/";
    document.cookie = "sl_mode=; max-age=0; path=/";
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PreferencesProvider initial={{ theme: "dark", mode: "self-study", themeExplicit: false }}>{children}</PreferencesProvider>
  );

  it("setTheme writes the cookie and toggles html.dark", () => {
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => usePreferences(), { wrapper });
    act(() => result.current.setTheme("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.cookie).toContain(`${PREFS_COOKIES.theme}=light`);
    expect(result.current.theme).toBe("light");
  });

  it("setMode toggles html.mode-classroom and switches an unset theme to light", () => {
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => usePreferences(), { wrapper });
    act(() => result.current.setMode("classroom"));
    expect(document.documentElement.classList.contains("mode-classroom")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.cookie).toContain(`${PREFS_COOKIES.mode}=classroom`);
  });
});
