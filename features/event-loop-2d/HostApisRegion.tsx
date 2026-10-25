"use client";

import { Cable } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { memo } from "react";
import type { HostEntry } from "@/core/timeline/Tick";
import { EmptyState, RegionFrame } from "./RegionFrame";
import { ChipShell, MAX_CHIPS, MoreChip } from "./TaskChip";

function detailOf(entry: HostEntry): string {
  const base = entry.dueMs === null ? entry.kind : `${entry.kind} · due ${entry.dueMs} ms`;
  return entry.refed ? base : `${base} · unref'd`;
}

/** Timers and immediates that Node has handed to libuv and not yet queued, each with its kind and virtual due time as text. */
export const HostApisRegion = memo(function HostApisRegion({ hosts }: { hosts: readonly HostEntry[] }) {
  const shown = hosts.slice(0, MAX_CHIPS);
  const hidden = hosts.length - shown.length;
  return (
    <RegionFrame testId="region-host" title="Host APIs" owner="Node/libuv" count={hosts.length} Icon={Cable} tone="webapi">
      {hosts.length === 0 ? (
        <EmptyState>empty: nothing is waiting on the host</EmptyState>
      ) : (
        <ol className="flex flex-wrap items-center gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {shown.map((entry) => (
              <ChipShell
                key={entry.id}
                testId="host-chip"
                // Not "task-<id>": the same timer sits in the Timers queue at once, and two live layout ids would fight.
                layoutId={`host-${entry.id}`}
                role="webapi"
                label={entry.label}
                detail={detailOf(entry)}
                tooltip={`waiting in libuv${entry.dueMs === null ? "" : ` until ${entry.dueMs} ms of virtual time`}`}
              />
            ))}
          </AnimatePresence>
          {hidden > 0 ? <MoreChip count={hidden} /> : null}
        </ol>
      )}
    </RegionFrame>
  );
});
