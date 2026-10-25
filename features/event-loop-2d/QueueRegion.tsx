"use client";

import { Circle, type LucideIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { memo } from "react";
import type { TaskRef, Tick } from "@/core/timeline/Tick";
import { EmptyState, RegionFrame } from "./RegionFrame";
import { type ChipRole, MAX_CHIPS, MoreChip, TaskChip } from "./TaskChip";
import { isOrderAtRisk } from "./warnings";

export type QueueRegionProps = {
  testId: string;
  title: string;
  /** "V8" or "Node/libuv": who owns the queue, spoken in the region's name. */
  owner: string;
  tasks: readonly TaskRef[];
  tone: ChipRole;
  icon?: LucideIcon;
  /** The current tick's warnings; a chip they call unreliable gets the yellow chip. */
  warnings?: Tick["warnings"];
};

const NO_WARNINGS: Tick["warnings"] = [];

/**
 * One queue as a horizontal lane read left to right, the head marked "next". It draws at most
 * MAX_CHIPS chips and folds the rest into "+N more". Memoized: a tick that leaves this queue's array
 * (and the warnings) unchanged does not re-render it.
 */
export const QueueRegion = memo(function QueueRegion({ testId, title, owner, tasks, tone, icon = Circle, warnings = NO_WARNINGS }: QueueRegionProps) {
  const shown = tasks.slice(0, MAX_CHIPS);
  const hidden = tasks.length - shown.length;
  return (
    <RegionFrame testId={testId} title={title} owner={owner} count={tasks.length} Icon={icon} tone={tone}>
      {tasks.length === 0 ? (
        <EmptyState />
      ) : (
        <ol className="flex flex-wrap items-center gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {shown.map((task, i) => (
              <TaskChip key={task.id} task={task} isNext={i === 0} warned={isOrderAtRisk(task, warnings)} />
            ))}
          </AnimatePresence>
          {hidden > 0 ? <MoreChip count={hidden} /> : null}
        </ol>
      )}
    </RegionFrame>
  );
});
