"use client";

import { useMemo, useState } from "react";
import { useStore } from "zustand";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import type { AsmSyntax } from "../../store/playgroundStore";
import { CodePane } from "./CodePane";
import { type PaneDocOptions, paneDoc, paneHeaders } from "./paneDocs";

type Form = "asm" | "hex" | "bin";

const isForm = (v: string): v is Form => v === "asm" || v === "hex" || v === "bin";
const isSyntax = (v: string): v is AsmSyntax => v === "att" || v === "intel";

/** Assembly (illustrative) or its encoded bytes in hex or binary (exact encoding of that assembly). */
export function MachineCodePane() {
  const store = usePlaygroundStore();
  const views = useStore(store, (s) => s.compile.views);
  // The syntax lives in the store so the Hardware board's readout follows the pane.
  const syntax = useStore(store, (s) => s.asmSyntax);
  const [form, setForm] = useState<Form>("asm");

  const pane = form === "asm" ? "asm" : "binary";
  const opts = useMemo<PaneDocOptions>(() => (form === "asm" ? { asmSyntax: syntax } : { byteFormat: form === "bin" ? "bin" : "hex" }), [form, syntax]);
  const doc = useMemo(() => (views ? paneDoc(views, pane, opts) : ""), [views, pane, opts]);
  const headers = useMemo(() => (views ? paneHeaders(views, pane) : []), [views, pane]);

  // Radix reports "" when the selected item is pressed again; one option is always selected.
  const actions = (
    <>
      <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={form} onValueChange={(v) => isForm(v) && setForm(v)} aria-label="Machine code form">
        <ToggleGroupItem value="asm">asm</ToggleGroupItem>
        <ToggleGroupItem value="hex">hex</ToggleGroupItem>
        <ToggleGroupItem value="bin">binary</ToggleGroupItem>
      </ToggleGroup>
      {form === "asm" ? (
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={syntax} onValueChange={(v) => isSyntax(v) && store.getState().setAsmSyntax(v)} aria-label="Assembly syntax">
          <ToggleGroupItem value="att">AT&amp;T</ToggleGroupItem>
          <ToggleGroupItem value="intel">Intel</ToggleGroupItem>
        </ToggleGroup>
      ) : null}
    </>
  );

  return (
    <CodePane
      pane={pane}
      doc={doc}
      label="Machine code"
      truth={form === "asm" ? "illustrative" : "exact-encoding"}
      headers={headers}
      actions={actions}
    />
  );
}
