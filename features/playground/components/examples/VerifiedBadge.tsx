"use client";

import { Check, TriangleAlert } from "lucide-react";
import type { Example } from "../../examples";
import { useActiveExample } from "../../examples/useActiveExample";

const SIMULATED = "Simulated by spec model";

/** What the recorded run backs for an example: a "Matches Node" claim only when a recording exists. */
export function ExampleStatus({ example, className }: { example: Example | null; className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${className ?? ""}`}>
      {example?.verified ? (
        <span className="inline-flex items-center gap-1 text-foreground">
          <Check aria-hidden="true" className="size-3 shrink-0 text-primary" />
          {`Matches Node v${example.verified.node} (V8 ${example.verified.v8})`}
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
  return <ExampleStatus example={useActiveExample()} />;
}
