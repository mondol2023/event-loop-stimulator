import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import type { ReactNode } from "react";
import type { ChipRole } from "./TaskChip";

const ICON_TEXT: Record<ChipRole, string> = { microtask: "text-microtask", nextTick: "text-microtask", macrotask: "text-macrotask", webapi: "text-webapi" };

/** A labelled region: an icon, a heading, a count, and `aria-label` and `data-testid` for tests and assistive tech. */
export function RegionFrame({
  testId,
  title,
  owner,
  count,
  Icon,
  tone,
  className,
  children,
}: {
  testId: string;
  title: string;
  owner: string;
  count: number;
  Icon: LucideIcon;
  tone?: ChipRole;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} aria-label={`${title}, owned by ${owner}`} className={cn("flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-panel p-3", className)}>
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-panel-foreground">
        <Icon aria-hidden="true" className={cn("size-4 shrink-0", tone ? ICON_TEXT[tone] : "text-muted-foreground")} />
        {title}
        <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
      </h3>
      {children}
    </section>
  );
}

/** The teaching empty state every region shares. */
export function EmptyState({ children = "empty: the loop moves on" }: { children?: string }) {
  return <p className="min-h-8 text-xs leading-8 text-muted-foreground">{children}</p>;
}
