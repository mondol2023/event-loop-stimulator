"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EventLoopViewLazy } from "../lazy";
import { TabPanel, tabTriggerProps } from "../shell/TabPanel";
import { TruthBadge } from "../TruthBadge";
import { PlaceholderPanel } from "./PlaceholderPanel";

export type BottomTab = "event-loop" | "v8" | "hardware";
export const isBottomTab = (v: string): v is BottomTab => v === "event-loop" || v === "v8" || v === "hardware";

const PANEL = "min-h-0 flex-1 outline-none";

type BottomPanelProps = {
  tab: BottomTab;
  onTabChange(tab: BottomTab): void;
  collapsed: boolean;
  onCollapsedChange(collapsed: boolean): void;
};

/** The run region: Event Loop (2D), V8 Internals and Hardware (3D) tabs, collapsible from lg up. */
export function BottomPanel({ tab, onTabChange, collapsed, onCollapsedChange }: BottomPanelProps) {
  const group = useId();
  const contentId = useId();
  return (
    <Tabs value={tab} onValueChange={(v) => isBottomTab(v) && onTabChange(v)} className="min-h-0 flex-1 gap-0 bg-panel">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-y border-border px-2">
        <TabsList variant="line" aria-label="Run views">
          <TabsTrigger value="event-loop" {...tabTriggerProps(group, "event-loop")}>
            Event Loop
          </TabsTrigger>
          <TabsTrigger value="v8" {...tabTriggerProps(group, "v8")}>
            V8 Internals
          </TabsTrigger>
          {/* The 3D view needs room; it is not offered on phones. */}
          <TabsTrigger value="hardware" {...tabTriggerProps(group, "hardware")} className="hidden md:inline-flex">
            Hardware
          </TabsTrigger>
        </TabsList>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-expanded={!collapsed}
            aria-controls={contentId}
            aria-label={collapsed ? "Expand the run panel" : "Collapse the run panel"}
            onClick={() => onCollapsedChange(!collapsed)}
            className="hidden lg:inline-flex"
          >
            {collapsed ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {/* Collapsing hides only the tab content; the tab strip and the playback bar stay. */}
      <div id={contentId} className={`min-h-0 flex-1 flex-col ${collapsed ? "flex lg:hidden" : "flex"}`}>
        <TabPanel group={group} value="event-loop" active={tab === "event-loop"} className={PANEL}>
          <EventLoopViewLazy />
        </TabPanel>
        <TabPanel group={group} value="v8" active={tab === "v8"} className={PANEL}>
          <PlaceholderPanel title="V8 Internals">
            <p>
              Phase 7 adds V8&apos;s own state for the running program: hidden classes (maps) and how objects transition between them, inline caches and their monomorphic to
              megamorphic states, the feedback vector each function owns, and the garbage collector&apos;s heap and its collections.
            </p>
            <p>This panel stays empty until then because each of those needs the simulator to record V8 heap and feedback state per tick, which the timeline does not carry yet.</p>
          </PlaceholderPanel>
        </TabPanel>
        <TabPanel group={group} value="hardware" active={tab === "hardware"} className={PANEL}>
          <PlaceholderPanel title="Hardware" badge={<TruthBadge level="illustrative" />}>
            <p>
              Phase 7 adds a view of the x64 machine behind the baseline code: the general-purpose registers, the cache hierarchy and the instruction pipeline, stepped alongside
              the machine code pane.
            </p>
            <p>
              It is not here yet because it needs per-instruction machine state from the simulator. When it arrives it will be an illustration of where the work happens, not a
              measurement.
            </p>
          </PlaceholderPanel>
        </TabPanel>
      </div>
    </Tabs>
  );
}
