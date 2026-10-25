"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching } from "@codemirror/language";
import { keymap } from "@codemirror/view";
import { type Ref, useEffect, useImperativeHandle, useMemo } from "react";
import { useStore } from "zustand";
import type { SourceRange } from "@/core/shared/diagnostics";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import { useCodeView } from "../panes/useCodeView";
import { diagnosticsExtension, diagnosticsSpec } from "./diagnosticsExtension";

export type SourceEditorHandle = { focusRange(range: SourceRange): void };

const BASE = [history(), bracketMatching(), keymap.of([...defaultKeymap, ...historyKeymap]), diagnosticsExtension];

/** The editable source: store text in, store text out, with the program's current and hovered lines outlined. */
export function SourceEditor({ ref }: { ref?: Ref<SourceEditorHandle> }) {
  const store = usePlaygroundStore();
  const source = useStore(store, (s) => s.editor.source);
  const lang = useStore(store, (s) => s.editor.lang);
  const diagnostics = useStore(store, (s) => s.editor.diagnostics);

  const language = useMemo(() => javascript({ typescript: lang === "ts" }), [lang]);
  const { host, view } = useCodeView({
    pane: "source",
    doc: source,
    label: "Source code",
    readOnly: false,
    base: BASE,
    dynamic: language,
    onDocChange: (text) => store.getState().setSource(text),
  });

  useEffect(() => {
    if (view) view.dispatch(diagnosticsSpec(view.state, diagnostics));
  }, [view, diagnostics]);

  useImperativeHandle(
    ref,
    () => ({
      focusRange(range) {
        if (!view) return;
        const length = view.state.doc.length;
        const anchor = Math.min(Math.max(range.start, 0), length);
        const head = Math.min(Math.max(range.end, anchor), length);
        view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
        view.focus();
      },
    }),
    [view],
  );

  return <div ref={host} className="h-full min-h-0 bg-panel" />;
}
