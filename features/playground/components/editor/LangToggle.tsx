"use client";

import { useStore } from "zustand";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePlaygroundStore } from "../../store/PlaygroundContext";

export function LangToggle() {
  const store = usePlaygroundStore();
  const lang = useStore(store, (s) => s.editor.lang);
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={lang}
      // Radix reports "" when the selected item is pressed again; a language is always selected.
      onValueChange={(v) => {
        if (v === "js" || v === "ts") store.getState().setLang(v);
      }}
      aria-label="Language"
    >
      <ToggleGroupItem value="js">JS</ToggleGroupItem>
      <ToggleGroupItem value="ts">TS</ToggleGroupItem>
    </ToggleGroup>
  );
}
