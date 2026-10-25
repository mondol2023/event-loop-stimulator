"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "sl_onboarded";

type Step = { target: string; title: string; body: string };

const STEPS: readonly Step[] = [
  { target: "editor", title: "The editor and examples", body: "Write JavaScript or TypeScript here, or load one of the ten examples. The views update as you type." },
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

export function CoachMarks() {
  // Loaded with ssr:false, so storage is read on the client only and the server markup never differs.
  const [visible, setVisible] = useState(() => !readDone());
  const [index, setIndex] = useState(0);
  const [place, setPlace] = useState<Place>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

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
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, dismiss]);

  useEffect(() => {
    if (visible) nextRef.current?.focus();
  }, [visible, index]);

  if (!visible || !step) return null;
  const last = index === STEPS.length - 1;

  // Anchored, the card sits inside its target on the edge nearer the screen's middle; unanchored, bottom center.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - 16);
  const left = place ? Math.min(Math.max(place.left + 12, 8), vw - width - 8) : (vw - width) / 2;
  const top = place ? (place.top > vh / 2 ? Math.max(place.top - 150, 8) : place.top + Math.min(place.height, 200) - 140) : Math.max(vh - 220, 8);

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
          <Button ref={nextRef} type="button" size="sm" onClick={() => (last ? dismiss() : setIndex(index + 1))}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
