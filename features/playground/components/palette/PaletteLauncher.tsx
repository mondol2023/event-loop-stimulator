"use client";

import { Command } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { isModalOpen } from "../../keyboard/shortcuts";
import { preloadReplaceExampleDialog, ReplaceExampleDialog, useChooseExample } from "../examples/ExamplesMenu";

// cmdk and CodeMirror load on first use, so the first-load JS (D6 budget) does not grow; only this chord listener ships eagerly.
const CommandPalette = lazy(() => import("./CommandPalette").then((m) => ({ default: m.CommandPalette })));
const StrippedJsDialog = lazy(() => import("./StrippedJsDialog").then((m) => ({ default: m.StrippedJsDialog })));

/**
 * Ctrl/Cmd+K anywhere, CodeMirror included: the capture phase runs before the editor's own keymap, and ADR-047 ignores modified keys.
 * The top bar's "Commands" button opens the same palette, so touch users reach it too.
 */
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
      // The browser's own Ctrl+K (focus the search bar) never fires here, even under another modal.
      e.preventDefault();
      // Another modal (the palette itself excepted) owns the keyboard: the palette does not open over it.
      if (!openRef.current && isModalOpen()) return;
      e.stopPropagation();
      if (!openRef.current) {
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        preloadReplaceExampleDialog();
      }
      setEverOpened(true);
      setOpen((o) => !o);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Commands"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={(e) => {
          returnFocusRef.current = e.currentTarget;
          preloadReplaceExampleDialog();
          setEverOpened(true);
          setOpen(true);
        }}
      >
        <Command aria-hidden="true" />
        <span className="hidden md:inline">Commands</span>
      </Button>
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
