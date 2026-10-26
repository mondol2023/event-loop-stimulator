"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { UsageMode } from "@/features/preferences/modes";
import { usePreferences } from "@/features/preferences/usePreferences";

export const MODES: readonly { value: UsageMode; label: string }[] = [
  { value: "self-study", label: "Self-study" },
  { value: "interview", label: "Interview prep" },
  { value: "classroom", label: "Classroom" },
];

const isMode = (v: string): v is UsageMode => MODES.some((m) => m.value === v);

/**
 * The usage mode and the theme, always on screen (PRODUCT.md: the mode is a visible, switchable control).
 * From 640 px the mode is a segmented control; below that it is a native select that still names the
 * current mode, and the theme stays one tap away in the command palette.
 */
export function TopBarControls() {
  const { mode, theme, setMode, setTheme } = usePreferences();
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <div className="flex items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        aria-label="Usage mode"
        value={mode}
        onValueChange={(v) => isMode(v) && setMode(v)}
        className="hidden sm:flex"
      >
        {MODES.map((m) => (
          <ToggleGroupItem key={m.value} value={m.value}>
            {m.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <label className="sm:hidden">
        <span className="sr-only">Usage mode</span>
        <select
          value={mode}
          onChange={(e) => isMode(e.target.value) && setMode(e.target.value)}
          className="field-sizing-content h-8 rounded-lg border border-border bg-background px-1.5 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11 dark:bg-input/30"
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={nextTheme === "light" ? "Switch to the light theme" : "Switch to the dark theme"}
        onClick={() => setTheme(nextTheme)}
        className="hidden sm:inline-flex"
      >
        {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </Button>
    </div>
  );
}
