"use client";

import { useNarration } from "../../hooks/useTickSelectors";

/**
 * What the current tick does, in words. The height is two lines whatever the text, and a longer text
 * scrolls inside, so stepping through ticks never moves the layout under the pointer.
 */
export function NarrationLine() {
  const narration = useNarration();
  return (
    // tabIndex: keyboard users must be able to scroll an overflowing region.
    <div
      role="status"
      aria-live="polite"
      aria-label="Narration"
      tabIndex={0}
      className="h-10 overflow-y-auto rounded-sm text-sm leading-5 text-panel-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {narration}
    </div>
  );
}
