"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

export function HardwareView() {
  const { mode, reason, setMode, reportContextLost } = useHwViewMode();
  const boardRef = useRef<HTMLDivElement>(null);

  // Review Focus 1: `webglcontextlost` does not bubble, so a capture listener on the wrapper sees the canvas's event.
  useEffect(() => {
    const el = boardRef.current;
    if (el === null || mode !== "3d") return;
    el.addEventListener("webglcontextlost", reportContextLost, true);
    return () => el.removeEventListener("webglcontextlost", reportContextLost, true);
  }, [mode, reportContextLost]);

  const notice = noticeFor(reason);

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="hardware-view">
      <div className="flex items-center gap-2 px-2 py-1">
        <div role="group" aria-label="Board view" className="flex gap-1">
          <Button type="button" size="xs" variant={mode === "3d" ? "secondary" : "outline"} aria-pressed={mode === "3d"} onClick={() => setMode("3d")}>
            3D
          </Button>
          <Button type="button" size="xs" variant={mode === "2d" ? "secondary" : "outline"} aria-pressed={mode === "2d"} onClick={() => setMode("2d")}>
            2D
          </Button>
        </div>
        {notice === null ? null : (
          <p role="status" className="text-xs text-muted-foreground">
            {notice}
          </p>
        )}
      </div>
      <div ref={boardRef} className="min-h-0 flex-1">
        {mode === "3d" ? <HardwareCanvas /> : <SvgBoard />}
      </div>
    </div>
  );
}
