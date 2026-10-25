import Link from "next/link";
import { type Diagnostic, lineColumn } from "@/core/shared/diagnostics";
import { docsHref } from "../../diagnostics/docsHref";

export type ProblemsListProps = {
  diagnostics: readonly Diagnostic[];
  /** The text the diagnostics' ranges index into. */
  source: string;
  /** Called when a row is chosen, so the owner can focus the editor at the range. */
  onSelect?: (diagnostic: Diagnostic) => void;
};

export function ProblemsList({ diagnostics, source, onSelect }: ProblemsListProps) {
  if (diagnostics.length === 0) return null;
  return (
    <ul aria-label="Problems" className="flex flex-col divide-y divide-border border-t border-border bg-panel text-sm">
      {diagnostics.map((d, i) => {
        const { line, column } = lineColumn(source, d.range.start);
        return (
          <li key={`${d.code}:${d.range.start}:${i}`} className="flex flex-col gap-0.5 px-3 py-2">
            <button
              type="button"
              onClick={() => onSelect?.(d)}
              className="text-left font-mono text-destructive hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {`L${line}:${column + 1} ${d.code} `}
              <span className="font-sans text-foreground">{d.message}</span>
            </button>
            <p className="text-muted-foreground">{d.hint}</p>
            <Link
              href={docsHref(d)}
              className="w-fit text-webapi underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Why?
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
