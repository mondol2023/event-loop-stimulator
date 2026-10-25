"use client";

import { CircleCheck, CircleDashed, CircleX, Loader, type LucideIcon, TriangleAlert } from "lucide-react";
import { useStore } from "zustand";
import { type PipelineStatus } from "../../store/playgroundStore";
import { usePlaygroundStore } from "../../store/PlaygroundContext";

const STATUS: Record<PipelineStatus, { label: string; Icon: LucideIcon }> = {
  idle: { label: "Idle", Icon: CircleDashed },
  compiling: { label: "Compiling…", Icon: Loader },
  simulating: { label: "Simulating…", Icon: Loader },
  ready: { label: "Ready", Icon: CircleCheck },
  refused: { label: "Refused", Icon: CircleX },
  failed: { label: "Failed", Icon: TriangleAlert },
};

/** The pipeline status as text with an icon, so it never relies on color. */
export function StatusIndicator() {
  const store = usePlaygroundStore();
  const status = useStore(store, (s) => s.compile.status);
  const message = useStore(store, (s) => s.compile.message);
  const { label, Icon } = STATUS[status];
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span role="status" data-testid="status">
        {label}
      </span>
      {message ? <span className="truncate text-warning">{message}</span> : null}
    </p>
  );
}
