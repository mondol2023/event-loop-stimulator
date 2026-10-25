"use client";

import { TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TaskRef } from "@/core/timeline/Tick";
import { useIsClient } from "./useIsClient";

/** The role a chip plays, which sets its edge color and its text label. */
export type ChipRole = "microtask" | "nextTick" | "macrotask" | "webapi";

/** At most this many chips are drawn per lane; the rest collapse into one "+N more" chip (a 100-timer program must not render 100 nodes). */
export const MAX_CHIPS = 12;

const ROLE_LABEL: Record<ChipRole, string> = { microtask: "microtask", nextTick: "nextTick", macrotask: "macrotask", webapi: "host" };

// Microtasks carry a solid violet edge, nextTicks a violet outline, timers and immediates amber, host entries cyan.
const ROLE_CLASS: Record<ChipRole, string> = {
  microtask: "border-border border-l-4 border-l-microtask",
  nextTick: "border-microtask",
  macrotask: "border-border border-l-4 border-l-macrotask",
  webapi: "border-border border-l-4 border-l-webapi",
};
const ROLE_TEXT: Record<ChipRole, string> = { microtask: "text-microtask", nextTick: "text-microtask", macrotask: "text-macrotask", webapi: "text-webapi" };

export function roleOf(kind: TaskRef["kind"]): ChipRole {
  switch (kind) {
    case "nextTick":
      return "nextTick";
    case "timeout":
    case "interval":
    case "immediate":
      return "macrotask";
    case "PromiseReactionJob":
    case "PromiseResolveThenableJob":
    case "CallbackJob":
      return "microtask";
  }
}

// The codebase's enter/exit tokens (app/globals.css): 220 ms in, 150 ms out, ease-out-quint. Only opacity
// fades on a chip; its position is the layout animation's, a spring with no overshoot.
const FADE_IN = { duration: 0.22, ease: [0.22, 1, 0.36, 1] } as const;
const FADE_OUT = { duration: 0.15, ease: [0.22, 1, 0.36, 1] } as const;
const MOVE = { type: "spring", stiffness: 500, damping: 32 } as const;

export type ChipShellProps = {
  testId: string;
  /** Shared across regions so a chip visibly travels when the same id appears in another lane. */
  layoutId: string;
  role: ChipRole;
  label: string;
  /** Plain-text detail beside the label, such as a host entry's kind and due time. */
  detail?: string;
  /** The tooltip's second line. */
  tooltip: string;
  isNext?: boolean;
  warned?: boolean;
};

/** One chip: label in mono, role in text, and its origin in a tooltip reachable by hover, focus and tap. */
export function ChipShell({ testId, layoutId, role, label, detail, tooltip, isNext = false, warned = false }: ChipShellProps) {
  const client = useIsClient();
  // Radix ignores touch pointers, so a tap toggles the tooltip by hand.
  const [open, setOpen] = useState(false);
  const className = cn(
    "flex min-h-8 max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-card-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    ROLE_CLASS[role],
    warned && "outline-1 outline-warning",
  );
  const content: ReactNode = (
    <>
      <span data-testid="task-label" className="min-w-0 truncate font-mono">
        {label}
      </span>
      <span className={cn("shrink-0 text-[0.7rem]", ROLE_TEXT[role])}>{detail ?? ROLE_LABEL[role]}</span>
      {isNext ? <span className="shrink-0 rounded-sm bg-muted px-1 text-[0.7rem] text-muted-foreground">next</span> : null}
      {warned ? (
        <span data-testid="warning-chip" className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-warning px-1 text-[0.7rem] text-warning">
          <TriangleAlert aria-hidden="true" className="size-3" />
          Order not guaranteed
        </span>
      ) : null}
    </>
  );
  const common = {
    "data-testid": testId,
    tabIndex: 0,
    "aria-description": tooltip,
    className,
    onClick: () => setOpen((o) => !o),
  } as const;
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          {client ? (
            <motion.li {...common} layoutId={layoutId} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { opacity: FADE_IN, layout: MOVE } }} exit={{ opacity: 0, transition: { opacity: FADE_OUT } }} transition={{ layout: MOVE }}>
              {content}
            </motion.li>
          ) : (
            <li {...common}>{content}</li>
          )}
        </TooltipTrigger>
        <TooltipContent>
          <span className="font-mono">{label}</span>
          <span>{tooltip}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** A task from a queue: the role follows its kind, and `warned` adds the yellow "Order not guaranteed" chip. */
export function TaskChip({ task, warned = false, isNext = false }: { task: TaskRef; warned?: boolean; isNext?: boolean }) {
  return (
    <ChipShell
      testId="task-chip"
      layoutId={`task-${task.id}`}
      role={roleOf(task.kind)}
      label={task.label}
      tooltip={`queued by ${task.origin}`}
      warned={warned}
      isNext={isNext}
    />
  );
}

/** The collapsed rest of a long lane. Not a task: no layout id, no tooltip. */
export function MoreChip({ count }: { count: number }) {
  return (
    <li data-testid="more-chip" className="flex min-h-8 items-center rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground">
      {`+${count} more`}
    </li>
  );
}
