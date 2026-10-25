"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { isModalOpen } from "../../keyboard/shortcuts";
import { ReplaceExampleDialog, useChooseExample } from "../examples/ExamplesMenu";

// cmdk and CodeMirror load on first use, so the first-load JS (D6 budget) does not grow; only this chord listener ships eagerly.
const CommandPalette = lazy(() => import("./CommandPalette").then((m) => ({ default: m.CommandPalette })));
const StrippedJsDialog = lazy(() => import("./StrippedJsDialog").then((m) => ({ default: m.StrippedJsDialog })));

/** Ctrl/Cmd+K anywhere, CodeMirror included: the capture phase runs before the editor's own keymap, and ADR-047 ignores modified keys. */
export function PaletteLauncher({ onShowHardware }: { onShowHardware(): void }) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [strippedOpen, setStrippedOpen] = useState(false);
  const [strippedEver, setStrippedEver] = useState(false);
  const choice = useChooseExample();
  const openRef = useRef(false);
  // Where focus was before the palette, for the dialogs a command opens to hand it back to.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // e.code, so non-Latin layouts work; macOS users press Cmd (metaKey), others Ctrl.
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.code !== "KeyK") return;
      e.preventDefault();
      e.stopPropagation();
      // Another modal (the palette itself excepted) owns the keyboard.
      if (!openRef.current && isModalOpen()) return;
      if (!openRef.current) returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
            onShowStrippedJs={() => {
              setStrippedEver(true);
              setStrippedOpen(true);
            }}
          />
        ) : null}
        {strippedEver ? <StrippedJsDialog open={strippedOpen} onOpenChange={setStrippedOpen} returnFocusRef={returnFocusRef} /> : null}
      </Suspense>
      <ReplaceExampleDialog choice={choice} returnFocusRef={returnFocusRef} />
    </>
  );
}
