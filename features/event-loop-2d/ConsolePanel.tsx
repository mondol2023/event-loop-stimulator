"use client";

import { SquareTerminal } from "lucide-react";
import { TruthBadge } from "@/features/playground/components/TruthBadge";
import { useConsole } from "@/features/playground/hooks/useTickSelectors";

/**
 * The program's output at the current tick. Lines are text nodes, never HTML. A stderr line is red and
 * carries its "stderr" label as generated content, so the element's text stays the program's exact output.
 */
export function ConsolePanel() {
  const lines = useConsole();
  return (
    <section aria-label="Console" className="flex min-h-0 min-w-0 flex-col gap-2 rounded-lg border border-border bg-panel p-3">
      <div className="flex items-center gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-panel-foreground">
          <SquareTerminal aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          Console
        </h3>
        <TruthBadge level="exact" />
      </div>
      {lines.length === 0 ? <p className="text-xs text-muted-foreground">No output yet.</p> : null}
      <pre
        data-testid="console"
        // The log can outgrow its box, so keyboard users need to scroll it.
        tabIndex={0}
        aria-label="Console output"
        className="max-h-60 min-h-12 flex-1 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-sm break-words whitespace-pre-wrap text-card-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {lines.map((line, i) =>
          line.stream === "stderr" ? (
            <span key={i} data-stream="stderr" title="stderr" className="text-destructive before:mr-2 before:text-xs before:content-['stderr']">
              {line.text}
            </span>
          ) : (
            <span key={i} data-stream="stdout">
              {line.text}
            </span>
          ),
        )}
      </pre>
    </section>
  );
}
