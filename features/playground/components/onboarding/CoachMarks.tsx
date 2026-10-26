"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
// The card's height before its first measurement (a two-line body with fine-pointer buttons); after that the
// rendered height is used, which is taller on coarse pointers (44 px buttons) and in Classroom's larger type.
const ESTIMATED_CARD_HEIGHT = 170;
const GAP = 12;
const MARGIN = 8;

export type Point = { top: number; left: number };

/**
 * Next to its target, never over it: below, above, right or left, the first side with room. A target that
 * leaves no room on any side (a phone segment fills the screen) gets the card at its bottom edge, inside.
 * Whatever the branch, the card is clamped inside the viewport, so its buttons are always on screen.
 */
export function placeCard(place: Place, vw: number, vh: number, width: number, height: number): Point {
  const clampLeft = (x: number): number => Math.max(Math.min(x, vw - width - MARGIN), MARGIN);
  const clampTop = (y: number): number => Math.max(Math.min(y, vh - height - MARGIN), MARGIN);
  const at = (top: number, left: number): Point => ({ top: clampTop(top), left: clampLeft(left) });
  if (!place) return at(vh - height - 48, (vw - width) / 2);
  const bottom = place.top + place.height;
  const right = place.left + place.width;
  if (bottom + GAP + height <= vh - MARGIN) return at(bottom + GAP, place.left);
  if (place.top - GAP - height >= MARGIN) return at(place.top - GAP - height, place.left);
  if (right + GAP + width <= vw - MARGIN) return at(place.top, right + GAP);
  if (place.left - GAP - width >= MARGIN) return at(place.top, place.left - GAP - width);
  return at(bottom - height - GAP, place.left + GAP);
}

export function CoachMarks() {
  // Loaded with ssr:false, so storage is read on the client only and the server markup never differs.
  const [visible, setVisible] = useState(() => !readDone());
  const [index, setIndex] = useState(0);
  const [place, setPlace] = useState<Place>(null);
  const [cardHeight, setCardHeight] = useState(ESTIMATED_CARD_HEIGHT);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // Back unmounts itself on the first step, so focus moves to Next instead of falling to the page.
  const focusNext = useRef(false);

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

  // Measured before paint: the card is placed from its real height, so a taller card never hangs off screen.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const height = el.getBoundingClientRect().height;
    if (height > 0 && Math.abs(height - cardHeight) > 0.5) setCardHeight(height);
  }, [cardHeight, index, visible, place]);

  useEffect(() => {
    if (focusNext.current && index === 0) {
      focusNext.current = false;
      nextRef.current?.focus();
    }
  }, [index]);

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
  const { top, left } = placeCard(place, vw, window.innerHeight, width, cardHeight);

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
        ref={cardRef}
        role="dialog"
        aria-label={step.title}
        // A card taller than the viewport scrolls inside, so its buttons stay reachable.
        className="fixed z-50 flex max-h-[calc(100dvh-1rem)] flex-col overflow-y-auto gap-2 rounded-lg bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10"
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                focusNext.current = index - 1 === 0;
                setIndex(index - 1);
              }}
            >
              Back
            </Button>
          ) : null}
          <Button ref={nextRef} type="button" size="sm" onClick={() => (last ? dismiss() : setIndex(index + 1))}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
