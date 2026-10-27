"use client";

import type { Extension } from "@codemirror/state";
import type { ReactNode } from "react";
import type { Pane } from "@/core/views/lineIndex";
import { TruthBadge, type TruthBadgeLevel } from "../TruthBadge";
import type { PaneHeader } from "./paneDocs";
import { useCodeView } from "./useCodeView";

export type CodePaneProps = {
  pane: Exclude<Pane, "source">;
  doc: string;
  label: string;
  truth: TruthBadgeLevel;
  headers?: readonly PaneHeader[];
  /** Controls shown beside the label (view toggles). */
  actions?: ReactNode;
  /** Extra CodeMirror behavior for this pane; must be memoized by the caller. */
  extension?: Extension;
};

/** A read-only, synchronized view of one compiled representation of the program. */
export function CodePane({ pane, doc, label, truth, headers, actions, extension }: CodePaneProps) {
  const { host } = useCodeView({ pane, doc, label, readOnly: true, ...(headers ? { headers } : {}), ...(extension ? { dynamic: extension } : {}) });
  return (
    <section aria-label={label} className="flex h-full min-h-0 flex-col bg-panel">
      <header className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        {/* The tab above already shows the name; the heading stays for assistive technology. */}
        <h2 className="sr-only">{label}</h2>
        <TruthBadge level={truth} />
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </header>
      <div ref={host} className="min-h-0 flex-1" />
    </section>
  );
}
