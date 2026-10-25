"use client";

// Stand-ins for surfaces that later Phase 6 tasks own. Each says what is missing in words and shows
// real data only; none of them invents values. They are replaced, not extended:
//   ViewPlaceholder -> Task 12 (PlaceholderPanel) for V8 Internals and Hardware

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
