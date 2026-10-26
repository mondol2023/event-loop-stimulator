"use client";

import { Check, TriangleAlert } from "lucide-react";
import type { Example } from "../../examples";
import { useActiveExample } from "../../examples/useActiveExample";

const SIMULATED = "Simulated by spec model";

/** What the recorded run backs for an example: a "Matches Node" claim only when a recording exists. */
export function ExampleStatus({ example, className, compact = false }: { example: Example | null; className?: string; compact?: boolean }) {
  const claim = example?.verified ? `Matches Node v${example.verified.node} (V8 ${example.verified.v8})` : null;
  return (
    <span className={`inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs ${className ?? ""}`}>
      {claim ? (
        // Compact (the editor header): a narrow header ends the line with an ellipsis rather than wrap it under the
        // toolbar; the whole claim stays in the text and the native tooltip.
        <span title={compact ? claim : undefined} className="inline-flex min-w-0 max-w-full items-center gap-1 text-foreground">
          <Check aria-hidden="true" className="size-3 shrink-0 text-primary" />
          <span className={compact ? "truncate" : undefined}>{claim}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">{SIMULATED}</span>
      )}
      {example?.nondeterministic ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 px-1.5 text-warning">
          <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
          Order not guaranteed in real Node
        </span>
      ) : null}
    </span>
  );
}

/**
 * The editor's proof line (D2). It reads "Matches Node" only while the text equals a recorded example
 * byte for byte; one edited character reverts it, because the claim is about that exact program.
 */
export function VerifiedBadge() {
  return <ExampleStatus example={useActiveExample()} compact />;
}
