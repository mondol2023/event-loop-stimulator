"use client";

import { cn } from "cn";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";

// In-house split (D8): shadcn Resizable renders SSR `style=` attributes, which the nonce CSP blocks.
// Here the server output is sized by classes only; a drag or key press writes `flex-basis` onto the
// first pane through a ref (CSSOM, which CSP allows), and a double click clears it back to the class.

export type ResizableSplitProps = {
  /** "horizontal" puts the panes side by side; "vertical" stacks them. */
  orientation: "horizontal" | "vertical";
  /** Names the drag handle for assistive technology. */
  label: string;
  first: ReactNode;
  second: ReactNode;
  /** Classes for the first pane: its default size (e.g. `lg:basis-2/5`) and its visibility. */
  firstClassName?: string;
  secondClassName?: string;
  className?: string;
  /** The size, in percent, that `firstClassName` gives the first pane; the handle starts there. */
  defaultPercent: number;
  /** Smallest share either pane may take, in percent. */
  minPercent?: number;
  /** Classes added to the handle, e.g. a breakpoint at which it appears. */
  handleClassName?: string;
};

const STEP = 2;
const BIG_STEP = 10;

export function ResizableSplit({
  orientation,
  label,
  first,
  second,
  firstClassName,
  secondClassName,
  className,
  defaultPercent,
  minPercent = 20,
  handleClassName,
}: ResizableSplitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLDivElement>(null);
  const [percent, setPercent] = useState(defaultPercent);
  const horizontal = orientation === "horizontal";
  const max = 100 - minPercent;

  const apply = (next: number): void => {
    const clamped = Math.min(Math.max(next, minPercent), max);
    if (firstRef.current) firstRef.current.style.flexBasis = `${clamped}%`;
    setPercent(Math.round(clamped * 10) / 10);
  };
  const reset = (): void => {
    if (firstRef.current) firstRef.current.style.flexBasis = "";
    setPercent(defaultPercent);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const size = horizontal ? rect.width : rect.height;
    if (size <= 0) return;
    apply((((horizontal ? e.clientX - rect.left : e.clientY - rect.top) / size) * 100));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? BIG_STEP : STEP;
    const grow = horizontal ? "ArrowRight" : "ArrowDown";
    const shrink = horizontal ? "ArrowLeft" : "ArrowUp";
    if (e.key === grow) apply(percent + step);
    else if (e.key === shrink) apply(percent - step);
    else if (e.key === "Home") apply(minPercent);
    else if (e.key === "End") apply(max);
    else if (e.key === "Enter") reset();
    else return;
    e.preventDefault();
  };

  return (
    <div ref={rootRef} className={cn("flex min-h-0 min-w-0", horizontal ? "flex-row" : "flex-col", className)}>
      <div ref={firstRef} className={cn("flex min-h-0 min-w-0 flex-col", firstClassName)}>
        {first}
      </div>
      <div
        role="separator"
        aria-label={label}
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuemin={minPercent}
        aria-valuemax={max}
        aria-valuenow={Math.round(percent)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        onDoubleClick={reset}
        className={cn(
          "shrink-0 touch-none bg-border transition-colors hover:bg-ring focus-visible:bg-ring focus-visible:outline-none",
          horizontal ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
          handleClassName,
        )}
      />
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", secondClassName)}>{second}</div>
    </div>
  );
}
