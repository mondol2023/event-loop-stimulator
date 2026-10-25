"use client";

import { Compartment, EditorState, type Extension, Annotation } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { type RefCallback, useCallback, useEffect, useRef, useState } from "react";
import type { Pane } from "@/core/views/lineIndex";
import { useHighlightedLines } from "../../hooks/useHighlightedLines";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import { useNonce } from "../csp/useNonce";
import { codeTheme } from "./codeTheme";
import { headerField, setHeaders } from "./headerWidgets";
import { highlightField, setHighlights } from "./highlightField";
import type { PaneHeader } from "./paneDocs";

// The CodeMirror plumbing shared by the read-only code panes and the source editor: creating the view
// with the CSP nonce, keeping its document and highlights in step with the store, scrolling the
// current line into view, and turning pointer movement into store hover.

const EXTERNAL = Annotation.define<boolean>();
const NO_HEADERS: readonly PaneHeader[] = [];

export type CodeViewOptions = {
  pane: Pane;
  /** The text the view should show. */
  doc: string;
  label: string;
  readOnly: boolean;
  /** Function headings as block widgets (read-only panes). */
  headers?: readonly PaneHeader[];
  /** Fixed for the lifetime of the view (keymaps, history, diagnostics state). */
  base?: Extension;
  /** May change between renders (the language); must be memoized by the caller. */
  dynamic?: Extension;
  /** Called with the new text when the user edits the document. */
  onDocChange?: (doc: string) => void;
};

export function useCodeView({ pane, doc, label, readOnly, headers = NO_HEADERS, base, dynamic, onDocChange }: CodeViewOptions): {
  host: RefCallback<HTMLDivElement>;
  view: EditorView | null;
} {
  const store = usePlaygroundStore();
  const nonce = useNonce();
  const { current, hovered } = useHighlightedLines(pane);
  const [view, setView] = useState<EditorView | null>(null);
  const [dynamicSlot] = useState(() => new Compartment());

  // What a (re)created view starts from, and the callbacks its handlers call: always the latest render's.
  const latest = useRef({ doc, dynamic, onDocChange });
  useEffect(() => {
    latest.current = { doc, dynamic, onDocChange };
  });

  const host = useCallback<RefCallback<HTMLDivElement>>(
    (el) => {
      if (!el) return;
      let frame = 0;
      let pointer: { x: number; y: number } | null = null;
      // Only this pane's own hover is cleared: another pane may own it by now, or a recompile may have reset it.
      const clearOwnHover = (): void => {
        if (store.getState().hover.pane === pane) store.getState().clearHover();
      };

      const created = new EditorView({
        parent: el,
        state: EditorState.create({
          doc: latest.current.doc,
          extensions: [
            lineNumbers(),
            EditorState.tabSize.of(2),
            codeTheme,
            highlightField,
            headerField,
            base ?? [],
            dynamicSlot.of(latest.current.dynamic ?? []),
            nonce ? EditorView.cspNonce.of(nonce) : [],
            readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
            EditorView.contentAttributes.of({ "aria-label": label, tabindex: "0" }),
            EditorView.updateListener.of((u) => {
              if (u.docChanged && !u.transactions.some((t) => t.annotation(EXTERNAL))) latest.current.onDocChange?.(u.state.doc.toString());
            }),
            EditorView.domEventHandlers({
              mousemove(event, v) {
                // Over a function heading there is no line to report, so the previous line's hover ends.
                if (event.target instanceof Element && event.target.closest(".cm-sl-fn-header")) {
                  cancelAnimationFrame(frame);
                  frame = 0;
                  pointer = null;
                  clearOwnHover();
                  return false;
                }
                pointer = { x: event.clientX, y: event.clientY };
                if (frame !== 0) return false;
                frame = requestAnimationFrame(() => {
                  frame = 0;
                  const at = pointer;
                  pointer = null;
                  const pos = at ? v.posAtCoords(at) : null;
                  if (pos === null) return;
                  const line = v.state.doc.lineAt(pos).number - 1;
                  // Compared with the store, not a local copy: a recompile resets the store's hover under us.
                  const { hover } = store.getState();
                  if (hover.pane === pane && hover.line === line) return;
                  store.getState().setHover(pane, line);
                });
                return false;
              },
              mouseleave() {
                cancelAnimationFrame(frame);
                frame = 0;
                pointer = null;
                clearOwnHover();
                return false;
              },
            }),
          ],
        }),
      });
      setView(created);
      return () => {
        cancelAnimationFrame(frame);
        // A destroyed pane receives no mouseleave, which would leave its last line outlined elsewhere.
        clearOwnHover();
        created.destroy();
        setView(null);
      };
    },
    [store, pane, nonce, label, readOnly, base, dynamicSlot],
  );

  useEffect(() => {
    if (view) view.dispatch({ effects: dynamicSlot.reconfigure(dynamic ?? []) });
  }, [view, dynamic, dynamicSlot]);

  // The document prop wins only when it changed: an in-flight render must not overwrite what the user just typed.
  const synced = useRef<{ view: EditorView | null; doc: string | null }>({ view: null, doc: null });
  useEffect(() => {
    if (!view) return;
    const isNew = synced.current.view !== view;
    const propChanged = isNew || synced.current.doc !== doc;
    synced.current = { view, doc };
    const replace = propChanged && view.state.doc.toString() !== doc;
    view.dispatch({
      ...(replace ? { changes: { from: 0, to: view.state.doc.length, insert: doc } } : {}),
      effects: [setHeaders.of(headers), setHighlights.of({ current, hovered })],
      annotations: EXTERNAL.of(true),
    });
  }, [view, doc, headers, current, hovered]);

  const first = current[0];
  useEffect(() => {
    if (!view || first === undefined || first >= view.state.doc.lines) return;
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(first + 1).from, { y: "nearest" }) });
  }, [view, doc, first]);

  return { host, view };
}
