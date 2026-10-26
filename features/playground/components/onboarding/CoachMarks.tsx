"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { EXAMPLES } from "../../examples";
import { isModalOpen } from "../../keyboard/shortcuts";

const STORAGE_KEY = "sl_onboarded";

type Step = { target: string; title: string; body: string };

const STEPS: readonly Step[] = [
  { target: "editor", title: "The editor and examples", body: `Write JavaScript or TypeScript here, or load one of the ${EXAMPLES.length} examples. The views update as you type.` },
  { target: "panes", title: "The panes", body: "Each pane shows one stage V8 goes through. Hover a line in any of them to see the same line lit in the others." },
  { target: "playback", title: "Play and the scrubber", body: "Press Play, or drag the scrubber, to move through the run one tick at a time." },
];

// Storage can be blocked; then the marks show once per load and nothing throws.
function readDone(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeDone(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Blocked storage: the marks come back on the next load, which is the documented fallback.
  }
}

type Place = { top: number; left: number; width: number; height: number } | null;

function measure(target: string): Place {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // A hidden region (a collapsed phone segment) has no box to point at.
  return r.width === 0 || r.height === 0 ? null : { top: r.top, left: r.left, width: r.width, height: r.height };
}

const CARD_WIDTH = 320;
// Measured from the rendered card with its two-line body; a taller card still stays on screen (the clamp below).
const CARD_HEIGHT = 170;
const GAP = 12;

type Point = { top: number; left: number };

/**
 * Next to its target, never over it: below, above, right or left, the first side with room. A target that
 * leaves no room on any side (a phone segment fills the screen) gets the card at its bottom edge, inside.
 */
function placeCard(place: Place, vw: number, vh: number, width: number): Point {
  const clampLeft = (x: number): number => Math.min(Math.max(x, 8), vw - width - 8);
  const clampTop = (y: number): number => Math.min(Math.max(y, 8), vh - CARD_HEIGHT - 8);
  if (!place) return { top: Math.max(vh - 220, 8), left: (vw - width) / 2 };
  const bottom = place.top + place.height;
  const right = place.left + place.width;
  if (bottom + GAP + CARD_HEIGHT <= vh) return { top: bottom + GAP, left: clampLeft(place.left) };
  if (place.top - GAP - CARD_HEIGHT >= 0) return { top: place.top - GAP - CARD_HEIGHT, left: clampLeft(place.left) };
  if (right + GAP + width <= vw) return { top: clampTop(place.top), left: right + GAP };
  if (place.left - GAP - width >= 0) return { top: clampTop(place.top), left: place.left - GAP - width };
  return { top: clampTop(bottom - CARD_HEIGHT - GAP), left: clampLeft(place.left + GAP) };
}

export function CoachMarks() {
  // Loaded with ssr:false, so storage is read on the client only and the server markup never differs.
  const [visible, setVisible] = useState(() => !readDone());
  const [index, setIndex] = useState(0);
  const [place, setPlace] = useState<Place>(null);

  const dismiss = useCallback(() => {
    writeDone();
    setVisible(false);
  }, []);

  const step = STEPS[index];
  useLayoutEffect(() => {
    if (!visible || !step) return;
    const update = (): void => setPlace(measure(step.target));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [visible, step]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent): void => {
      // An Escape that closed a dialog is already handled; it must not also end the tour for good.
      if (e.key === "Escape" && !e.defaultPrevented && !isModalOpen()) dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, dismiss]);

  if (!visible || !step) return null;
  const last = index === STEPS.length - 1;

  const vw = window.innerWidth;
  const width = Math.min(CARD_WIDTH, vw - 16);
  const { top, left } = placeCard(place, vw, window.innerHeight, width);

  return createPortal(
    <>
      {place ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 rounded-md ring-2 ring-ring"
          style={{ top: place.top, left: place.left, width: place.width, height: place.height }}
        />
      ) : null}
      <div
        role="dialog"
        aria-label={step.title}
        className="fixed z-50 flex flex-col gap-2 rounded-lg bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10"
        style={{ top, left, width }}
      >
        <h2 className="font-medium">{step.title}</h2>
        <p className="text-muted-foreground">{step.body}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{`${index + 1} of ${STEPS.length}`}</span>
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={dismiss}>
            Skip
          </Button>
          {index > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={() => (last ? dismiss() : setIndex(index + 1))}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
