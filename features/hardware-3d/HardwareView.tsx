"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHardwareFrame, type HardwareFrame } from "../playground/hooks/useHardwareFrame";
import { usePlaygroundStore } from "../playground/store/PlaygroundContext";
import { boardReading } from "./readout";
import { useHwViewMode, type HardwareViewReason } from "./useHwViewMode";

function BoardSkeleton() {
  return <Skeleton className="h-full min-h-48 w-full rounded-none" aria-hidden="true" />;
}

// D5: each board is its own chunk, so the 2D path never loads three.
const HardwareCanvas = dynamic(() => import("./board/HardwareCanvas"), { ssr: false, loading: BoardSkeleton });
const SvgBoard = dynamic(() => import("./SvgBoard"), { ssr: false, loading: BoardSkeleton });

function noticeFor(reason: HardwareViewReason): string | null {
  if (reason === "no-webgl" || reason === "context-lost") return "3D unavailable; showing the 2D board";
  if (reason === "narrow") return "2D board on small screens";
  return null;
}

/** The board's reading as text, legible at any board size; written through a ref, so a tick never re-renders React. */
function Readout({ hidden }: { hidden: boolean }) {
  const store = usePlaygroundStore();
  const el = useRef<HTMLParagraphElement>(null);
  const write = useCallback(
    (f: HardwareFrame | null) => {
      if (!el.current) return;
      const text = boardReading(f, store.getState());
      el.current.textContent = text;
      el.current.title = text;
    },
    [store],
  );
  const frame = useHardwareFrame(write);
  useEffect(() => {
    write(frame.current);
    return store.subscribe((s) => s.asmSyntax, () => write(frame.current));
  }, [store, frame, write]);
  // One fixed line above the board, so a tick never resizes it; the side column (no effect on the board's size) may wrap.
  return (
    <p
      ref={el}
      data-testid="hw-readout"
      aria-hidden={hidden || undefined}
      className="h-5 min-w-0 truncate font-mono text-xs leading-5 text-foreground tabular-nums @5xl:h-auto @5xl:overflow-visible @5xl:break-words @5xl:whitespace-normal"
    />
  );
}

export function HardwareView() {
  const store = usePlaygroundStore();
  const status = useStore(store, (s) => s.compile.status);
  const message = useStore(store, (s) => s.compile.message);
  const { mode, reason, setMode, reportContextLost } = useHwViewMode();
  // A state ref, so the listener follows each board div that mounts (a refused run unmounts it).
  const [board, setBoard] = useState<HTMLDivElement | null>(null);

  // Review Focus 1: `webglcontextlost` does not bubble, so a capture listener on the wrapper sees the canvas's event.
  useEffect(() => {
    if (board === null || mode !== "3d") return;
    board.addEventListener("webglcontextlost", reportContextLost, true);
    return () => board.removeEventListener("webglcontextlost", reportContextLost, true);
  }, [board, mode, reportContextLost]);

  if (status === "refused") return <p className="p-3 text-sm text-muted-foreground">Nothing to inspect yet: fix the problem in the editor first.</p>;
  if (status === "failed") return <p className="p-3 text-sm text-muted-foreground">{`The run couldn't finish: ${(message ?? "unknown error").replace(/\.$/, "")}.`}</p>;

  const notice = noticeFor(reason);

  // Wide panels put the toolbar in a side column, so the short default panel gives its full height to the board.
  return (
    <div className="@container flex h-full min-h-0 flex-col" data-slot="hardware-view">
      <div className="flex h-full min-h-0 flex-col @5xl:flex-row">
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 @5xl:w-60 @5xl:flex-col @5xl:flex-nowrap @5xl:items-start @5xl:border-r @5xl:border-border @5xl:py-2">
          <div role="group" aria-label="Board view" className="flex gap-1 pointer-coarse:gap-2">
            <Button type="button" size="xs" variant={mode === "3d" ? "secondary" : "ghost"} aria-pressed={mode === "3d"} onClick={() => setMode("3d")}>
              3D
            </Button>
            <Button type="button" size="xs" variant={mode === "2d" ? "secondary" : "ghost"} aria-pressed={mode === "2d"} onClick={() => setMode("2d")}>
              2D
            </Button>
          </div>
          {notice === null ? null : (
            <p role="status" className="text-xs text-muted-foreground">
              {notice}
            </p>
          )}
          <div className="w-full min-w-0 @5xl:mt-1">
            <Readout hidden={mode === "3d"} />
          </div>
        </div>
        <div ref={setBoard} className="min-h-0 min-w-0 flex-1">
          {mode === "3d" ? <HardwareCanvas /> : <SvgBoard />}
        </div>
      </div>
    </div>
  );
}
