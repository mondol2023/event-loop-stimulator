"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EventLoopViewLazy, HardwareViewLazy, V8InternalsViewLazy } from "../lazy";
import { TabPanel, tabTriggerProps } from "../shell/TabPanel";

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
          {/* Phones get the 2D board (D5), so the tab is offered at every width. */}
          <TabsTrigger value="hardware" {...tabTriggerProps(group, "hardware")}>
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
          <V8InternalsViewLazy />
        </TabPanel>
        <TabPanel group={group} value="hardware" active={tab === "hardware"} className={PANEL}>
          <HardwareViewLazy />
        </TabPanel>
      </div>
    </Tabs>
  );
}
