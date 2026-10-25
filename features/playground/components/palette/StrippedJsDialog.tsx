"use client";

import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useCallback } from "react";
import { useStore } from "zustand";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import { useNonce } from "../csp/useNonce";
import { codeTheme } from "../panes/codeTheme";

/** The JavaScript left after TypeScript is stripped, as a read-only document. */
export function StrippedJsDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const store = usePlaygroundStore();
  const stripped = useStore(store, (s) => s.compile.strippedJs) ?? "";
  const nonce = useNonce();

  const host = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const view = new EditorView({
        parent: el,
        state: EditorState.create({
          doc: stripped,
          extensions: [
            lineNumbers(),
            codeTheme,
            javascript(),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            EditorView.contentAttributes.of({ "aria-label": "Stripped JavaScript", tabindex: "0" }),
            nonce ? EditorView.cspNonce.of(nonce) : [],
          ],
        }),
      });
      return () => view.destroy();
    },
    [stripped, nonce],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Stripped JavaScript</DialogTitle>
          <DialogDescription>What the simulator runs after the type annotations are removed.</DialogDescription>
        </DialogHeader>
        <div ref={host} className="h-[min(60dvh,28rem)] overflow-hidden rounded-md border border-border" />
      </DialogContent>
    </Dialog>
  );
}
