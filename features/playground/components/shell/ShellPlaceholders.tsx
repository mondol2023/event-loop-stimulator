"use client";

import { useEffect } from "react";
import { useStore } from "zustand";
import { useConsole } from "../../hooks/useTickSelectors";
import { usePlaygroundStore } from "../../store/PlaygroundContext";

// Stand-ins for surfaces that later Phase 6 tasks own. Each says what is missing in words and shows
// real data only; none of them invents values. They are replaced, not extended:
//   PlaybackPlaceholder   -> Task 9 (PlaybackBar, Scrubber, NarrationLine)
//   EventLoopPlaceholder  -> Task 10 (EventLoopView, ConsolePanel)
//   ViewPlaceholder       -> Task 12 (PlaceholderPanel) for V8 Internals and Hardware

export function PlaybackPlaceholder() {
  return (
    <section aria-label="Playback" className="flex h-16 shrink-0 items-center border-t border-border bg-panel px-3 text-sm text-muted-foreground">
      The playback controls and the narration line are not built yet.
    </section>
  );
}

/** The program's output at the current tick, until the console panel replaces it. */
export function EventLoopPlaceholder() {
  const store = usePlaygroundStore();
  const status = useStore(store, (s) => s.compile.status);
  const length = useStore(store, (s) => s.playback.length);
  const lines = useConsole();

  // With no playback bar yet, nothing else can move the cursor: show the finished run's output.
  // The playback bar (Task 9) owns the cursor and removes this.
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
