"use client";

import { useStore } from "zustand";
import { usePlaygroundStore } from "@/features/playground/store/PlaygroundContext";
import { ElementsLattice } from "./ElementsLattice";
import { FrameInspector } from "./FrameInspector";
import { IcTable } from "./IcTable";

/**
 * The V8 Internals tab: three columns that follow the tab's own width (container query), from the current
 * instruction outward (docs/design/internals-hardware-shape.md §3). The empty `data-slot` boxes are where the
 * hidden-class graph, the heap strip and the tier timeline mount; they take no room until they hold a panel.
 */
export function V8InternalsView() {
  const store = usePlaygroundStore();
  const status = useStore(store, (s) => s.compile.status);
  const message = useStore(store, (s) => s.compile.message);

  if (status === "refused") return <p className="p-3 text-sm text-muted-foreground">Nothing to inspect yet: fix the problem in the editor first.</p>;
  if (status === "failed") return <p className="p-3 text-sm text-muted-foreground">{`The run couldn't finish: ${message ?? "unknown error"}.`}</p>;

  return (
    <div className="@container h-full min-h-0 overflow-auto p-2">
      <div className="grid gap-2 @3xl:grid-cols-[26fr_44fr_30fr] @3xl:items-start">
        <div data-slot="frame" className="min-w-0 @3xl:min-w-60">
          <FrameInspector />
        </div>
        <div data-slot="column-b" className="flex min-w-0 flex-col gap-2">
          <div data-slot="hidden-classes" className="empty:hidden" />
          <IcTable />
          <div data-slot="tiers" className="empty:hidden" />
        </div>
        <div data-slot="column-c" className="flex min-w-0 flex-col gap-2">
          <ElementsLattice />
          <div data-slot="heap" className="empty:hidden" />
        </div>
      </div>
    </div>
  );
}
