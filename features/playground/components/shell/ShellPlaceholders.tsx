"use client";

import { useEffect } from "react";
import { useStore } from "zustand";
import { useConsole } from "../../hooks/useTickSelectors";
import { usePlaygroundStore } from "../../store/PlaygroundContext";

// Stand-ins for surfaces that later Phase 6 tasks own. Each says what is missing in words and shows
// real data only; none of them invents values. They are replaced, not extended:
//   EventLoopPlaceholder  -> Task 10 (EventLoopView, ConsolePanel)
//   ViewPlaceholder       -> Task 12 (PlaceholderPanel) for V8 Internals and Hardware

/** The program's output at the current tick, until the console panel replaces it. */
export function EventLoopPlaceholder() {
  const store = usePlaygroundStore();
  const status = useStore(store, (s) => s.compile.status);
  const length = useStore(store, (s) => s.playback.length);
  const lines = useConsole();

  // Until the console panel (Task 10) follows the cursor itself, a finished run opens on its last tick so its
  // output is visible; the playback bar then takes over the cursor.
  useEffect(() => {
    if (status === "ready" && length > 0) store.getState().seek(length - 1);
  }, [store, status, length]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <p className="text-sm text-muted-foreground">The animated event loop view is not built yet. The program&rsquo;s console output is below.</p>
      <h3 className="text-xs font-medium text-muted-foreground">Console</h3>
      <pre data-testid="console" className="min-h-12 flex-1 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-sm text-card-foreground">
        {lines.map((l) => l.text).join("")}
      </pre>
    </div>
  );
}

export function ViewPlaceholder({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-3">
      <h3 className="text-sm font-medium text-panel-foreground">{title}</h3>
      <p className="max-w-prose text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export const V8_INTERNALS_COPY =
  "This panel is not built yet. It will show V8's own state for the running program: the frame inspector, the hidden-class graph, the inline-cache table, the elements-kind lattice, the heap strip and the tier timeline. Each panel will carry its own truth badge.";

export const HARDWARE_COPY =
  "This view is not built yet. It will draw the CPU board for the machine code being run, with a 2D fallback. It is an illustration of where the work happens, not a measurement.";
