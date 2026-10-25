"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { usePreferences } from "@/features/preferences/usePreferences";
import type { UsageMode } from "@/features/preferences/modes";
import { EXAMPLES, type Example } from "../../examples";
import { usePlaygroundStore, useRunNow } from "../../store/PlaygroundContext";

type Page = "root" | "examples" | "mode" | "tick";

const MODES: readonly { value: UsageMode; label: string }[] = [
  { value: "self-study", label: "Self-study" },
  { value: "interview", label: "Interview" },
  { value: "classroom", label: "Classroom" },
];

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
  const { setTheme, setMode } = usePreferences();
  const hasStripped = useStore(store, (s) => s.compile.strippedJs !== null);
  const [page, setPage] = useState<Page>("root");
  const [search, setSearch] = useState("");

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

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) go("root");
      }}
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
          <CommandEmpty>No matching command.</CommandEmpty>
          {page === "root" ? (
            <CommandGroup heading="Commands">
              <CommandItem onSelect={run(runNow)}>Run</CommandItem>
              <CommandItem onSelect={() => go("examples")}>Examples ›</CommandItem>
              <CommandItem onSelect={() => go("tick")}>Go to tick…</CommandItem>
              <CommandItem onSelect={run(onShowHardware)}>Toggle 3D</CommandItem>
              <CommandItem disabled={!hasStripped} onSelect={run(onShowStrippedJs)}>
                Show stripped JS
              </CommandItem>
              <CommandItem onSelect={run(() => setTheme("light"))}>Theme: Light</CommandItem>
              <CommandItem onSelect={run(() => setTheme("dark"))}>Theme: Dark</CommandItem>
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
                <CommandItem key={m.value} onSelect={run(() => setMode(m.value))}>
                  {m.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {page === "tick" && tick !== null && tick >= 1 ? (
            <CommandGroup heading="Go to tick">
              <CommandItem value={`tick-${tick}`} onSelect={run(() => store.getState().seek(tick - 1))}>
                {`Go to tick ${tick}`}
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
