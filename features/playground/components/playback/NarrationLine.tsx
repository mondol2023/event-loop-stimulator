"use client";

import type { ReactNode } from "react";
import { useStore } from "zustand";
import { useConsoleHidden } from "../../hooks/useConsoleHidden";
import { useNarration, useNarrationWithheld } from "../../hooks/useTickSelectors";
import { usePlaygroundStore } from "../../store/PlaygroundContext";

/**
 * The narration quotes code between backticks. Each quoted span renders as mono text and the backticks go;
 * an unpaired backtick stays as typed. Everything is a text node, never HTML.
 */
export function narrationParts(text: string): ReactNode[] {
  const parts = text.split("`");
  // An even number of pieces means an odd number of backticks: one has no partner, so show the text as is.
  if (parts.length < 3 || parts.length % 2 === 0) return [text];
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="font-mono text-[0.95em]">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

/**
 * What the current tick does, in words. The height is two lines whatever the text, and a longer text
 * scrolls inside, so stepping through ticks never moves the layout under the pointer.
 */
export function NarrationLine() {
  // Predict-first: the narration must not quote output the console is still hiding.
  const { hidden } = useConsoleHidden();
  const narration = useNarration();
  const withheld = useNarrationWithheld();
  const shown = hidden ? withheld : narration;
  // While playing, every tick would be announced (eight a second at 8x); the tick the run stops on is read out.
  const playing = useStore(usePlaygroundStore(), (s) => s.playback.isPlaying);
  return (
    // tabIndex: keyboard users must be able to scroll an overflowing region.
    <div
      role="status"
      aria-live={playing ? "off" : "polite"}
      aria-label="Narration"
      tabIndex={0}
      className="h-10 overflow-y-auto rounded-sm text-sm leading-5 text-panel-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {/* Keyed by the text: a reused <code> element moving with new text would count as a layout shift each tick. */}
      <span key={shown}>{narrationParts(shown)}</span>
    </div>
  );
}
