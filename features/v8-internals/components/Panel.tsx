import type { ReactNode } from "react";

/** One V8 Internals panel: a named region whose header carries its summary and its own truth badge (docs/design/internals-hardware-shape.md §11). */
export function Panel({ label, summary, badge, caption, children }: { label: string; summary?: ReactNode; badge: ReactNode; caption?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex min-h-0 min-w-0 flex-col gap-1 rounded-lg border border-border bg-panel p-2">
      <header data-testid="panel-header" className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-medium text-panel-foreground">{label}</h3>
        {summary ? <span className="min-w-0 text-xs text-muted-foreground">{summary}</span> : null}
        <span className="ml-auto">{badge}</span>
      </header>
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
      {children}
    </section>
  );
}

/** The `Map#n` chip; hover sync with the hidden-class graph arrives with that panel. */
export function MapChip({ id }: { id: number }) {
  return <span className="inline-flex rounded border border-border bg-card px-1 font-mono text-xs text-card-foreground">{`Map#${id}`}</span>;
}
