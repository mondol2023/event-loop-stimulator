"use client";

import type { ReactNode } from "react";

/** A panel Phase 7 builds: it says what that phase adds and why it is not here, and shows no data. */
export function PlaceholderPanel({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-panel-foreground">{title}</h3>
        {badge}
      </div>
      <div className="flex max-w-prose flex-col gap-2 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
