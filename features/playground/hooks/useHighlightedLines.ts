import { useStoreWithEqualityFn } from "zustand/traditional";
import { linesForPositions, type Pane, positionsForLine } from "@/core/views/lineIndex";
import { usePlaygroundStore } from "../store/PlaygroundContext";
import type { PlaygroundState } from "../store/playgroundStore";
import { getTimeline } from "../store/timelineHolder";

export type HighlightedLines = { current: readonly number[]; hovered: readonly number[] };

const NO_LINES: readonly number[] = [];

function sameLines(a: readonly number[], b: readonly number[]): boolean {
  return a === b || (a.length === b.length && a.every((line, i) => line === b[i]));
}

const sameHighlights = (a: HighlightedLines, b: HighlightedLines): boolean => sameLines(a.current, b.current) && sameLines(a.hovered, b.hovered);

function highlights(state: PlaygroundState, pane: Pane, timeline: ReturnType<typeof getTimeline>): HighlightedLines {
  const { lineIndex } = state.compile;
  if (!lineIndex) return { current: NO_LINES, hovered: NO_LINES };
  const pos = timeline && state.playback.length > 0 ? timeline.at(state.playback.index).pos : null;
  const { pane: hoverPane, line } = state.hover;
  return {
    current: pos ? linesForPositions(lineIndex, pane, [pos]) : NO_LINES,
    hovered: hoverPane !== null && line !== null ? linesForPositions(lineIndex, pane, positionsForLine(lineIndex, hoverPane, line)) : NO_LINES,
  };
}

/** The 0-based lines of `pane` to highlight: where execution is now, and what the pointer is over in any pane. */
export function useHighlightedLines(pane: Pane): HighlightedLines {
  const store = usePlaygroundStore();
  // Element-wise equality keeps a seek that lands on the same lines from re-rendering the pane.
  return useStoreWithEqualityFn(store, (s) => highlights(s, pane, getTimeline(store)), sameHighlights);
}
