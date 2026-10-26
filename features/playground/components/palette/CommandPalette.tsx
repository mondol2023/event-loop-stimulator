"use client";

import { useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { usePreferences } from "@/features/preferences/usePreferences";
import { EXAMPLES, type Example } from "../../examples";
import { usePlaygroundStore, useRunNow } from "../../store/PlaygroundContext";
import { MODES } from "../shell/TopBarControls";

type Page = "root" | "examples" | "mode" | "tick";

// The Hardware tab, and so "Toggle 3D", exists from md (768 px) up. Without matchMedia (jsdom) it counts as wide.
const WIDE = "(min-width: 768px)";
const hasMatchMedia = (): boolean => typeof window.matchMedia === "function";
function subscribeWide(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => undefined;
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const isWide = (): boolean => !hasMatchMedia() || window.matchMedia(WIDE).matches;

function Current() {
  return <span className="ml-auto text-xs text-muted-foreground">current</span>;
}

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  onChooseExample(example: Example): void;
  onShowHardware(): void;
  onShowStrippedJs(): void;
};

export function CommandPalette({ open, onOpenChange, onChooseExample, onShowHardware, onShowStrippedJs }: CommandPaletteProps) {
  const store = usePlaygroundStore();
  const runNow = useRunNow();
  const { theme, mode, setTheme, setMode } = usePreferences();
  // The palette is client-only (lazy), so the server snapshot is never rendered.
  const wide = useSyncExternalStore(subscribeWide, isWide, () => true);
  const hasStripped = useStore(store, (s) => s.compile.strippedJs !== null);
  const [page, setPage] = useState<Page>("root");
  const [search, setSearch] = useState("");
  const length = useStore(store, (s) => s.playback.length);

  // Every way of closing (a command, Esc, the Ctrl+K toggle) lands here, so reopening always starts at the root.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setPage("root");
      setSearch("");
    }
  }

  const go = (next: Page): void => {
    setPage(next);
    setSearch("");
  };
  const close = (): void => onOpenChange(false);
  const run = (fn: () => void) => (): void => {
    fn();
    close();
  };

  const tick = /^\d+$/.test(search.trim()) ? Number(search.trim()) : null;
  // Past the end it lands on the last tick, and says so.
  const target = tick !== null && length > 0 ? Math.min(tick, length) : tick;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Run a command, load an example, or jump to a tick."
    >
      {/* The tick page filters nothing: its one item is built from what was typed. */}
      <Command shouldFilter={page !== "tick"}>
        <CommandInput
          value={search}
          onValueChange={setSearch}
          placeholder={page === "tick" ? "Tick number, from 1" : "Type a command"}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && search === "" && page !== "root") go("root");
          }}
        />
        <CommandList>
          {page === "tick" ? null : <CommandEmpty>No matching command.</CommandEmpty>}
          {page === "tick" && (tick === null || tick < 1) ? <p className="px-2 py-3 text-sm text-muted-foreground">Type a tick number, from 1.</p> : null}
          {page === "root" ? (
            <CommandGroup heading="Commands">
              <CommandItem
                onSelect={run(() => {
                  runNow();
                  // Nothing was waiting to compile, so the run on screen is current: play it again from the start.
                  const s = store.getState();
                  if (s.compile.status === "ready" && s.playback.length > 0) {
                    s.seek(0);
                    s.play();
                  }
                })}
              >
                Run
              </CommandItem>
              <CommandItem onSelect={() => go("examples")}>Examples ›</CommandItem>
              <CommandItem onSelect={() => go("tick")}>Go to tick…</CommandItem>
              {wide ? <CommandItem onSelect={run(onShowHardware)}>Toggle 3D</CommandItem> : null}
              <CommandItem disabled={!hasStripped} onSelect={run(onShowStrippedJs)}>
                Show stripped JS
              </CommandItem>
              <CommandItem value="Theme: Light" onSelect={run(() => setTheme("light"))}>
                Theme: Light
                {theme === "light" ? <Current /> : null}
              </CommandItem>
              <CommandItem value="Theme: Dark" onSelect={run(() => setTheme("dark"))}>
                Theme: Dark
                {theme === "dark" ? <Current /> : null}
              </CommandItem>
              <CommandItem onSelect={() => go("mode")}>Mode ›</CommandItem>
            </CommandGroup>
          ) : null}
          {page === "examples" ? (
            <CommandGroup heading="Examples">
              {EXAMPLES.map((example) => (
                <CommandItem key={example.id} value={`${example.title} ${example.blurb}`} onSelect={run(() => onChooseExample(example))}>
                  {example.title}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {page === "mode" ? (
            <CommandGroup heading="Mode">
              {MODES.map((m) => (
                <CommandItem key={m.value} value={m.label} onSelect={run(() => setMode(m.value))}>
                  {m.label}
                  {mode === m.value ? <Current /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {page === "tick" && tick !== null && tick >= 1 ? (
            <CommandGroup heading="Go to tick">
              <CommandItem value={`tick-${tick}`} onSelect={run(() => store.getState().seek((target ?? tick) - 1))}>
                {`Go to tick ${target ?? tick}`}
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
