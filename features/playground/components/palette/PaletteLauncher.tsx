"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { ReplaceExampleDialog, useChooseExample } from "../examples/ExamplesMenu";

// cmdk and CodeMirror load on first use, so the first-load JS (D6 budget) does not grow; only this chord listener ships eagerly.
const CommandPalette = lazy(() => import("./CommandPalette").then((m) => ({ default: m.CommandPalette })));
const StrippedJsDialog = lazy(() => import("./StrippedJsDialog").then((m) => ({ default: m.StrippedJsDialog })));

/** Ctrl/Cmd+K anywhere, CodeMirror included: the capture phase runs before the editor's own keymap, and ADR-047 ignores modified keys. */
export function PaletteLauncher({ onShowHardware }: { onShowHardware(): void }) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [strippedOpen, setStrippedOpen] = useState(false);
  const choice = useChooseExample();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      e.stopPropagation();
      setEverOpened(true);
      setOpen((o) => !o);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        {everOpened ? (
          <CommandPalette
            open={open}
            onOpenChange={setOpen}
            onChooseExample={choice.choose}
            onShowHardware={onShowHardware}
            onShowStrippedJs={() => setStrippedOpen(true)}
          />
        ) : null}
        {strippedOpen ? <StrippedJsDialog open onOpenChange={setStrippedOpen} /> : null}
      </Suspense>
      <ReplaceExampleDialog choice={choice} />
    </>
  );
}
