"use client";

import { Recycle } from "lucide-react";
import type { ReactNode } from "react";
import type { DeepReadonly, V8Snapshot } from "@/core/timeline/Tick";
import { useV8State } from "@/features/playground/hooks/useTickSelectors";
import { TruthBadge } from "@/features/playground/components/TruthBadge";
import { useEnterMotion } from "../hooks/useEnterMotion";
import { useGcFresh } from "../hooks/useGcFresh";
import { heapStrip } from "../model/heapStrip";
import { Panel } from "./Panel";

const CELLS = 64;
const CAPTION = "Sizes are estimates; GC never changes your program's output.";
const NO_GC = "No garbage collection so far: small programs often finish without one.";
const EMPTY_REGION = { objectCount: 0, usedBytes: 0, capacityBytes: 0 };
const EMPTY_HEAP: DeepReadonly<V8Snapshot["heap"]> = { young: EMPTY_REGION, old: EMPTY_REGION };

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round(n / (1024 * 1024))} MB`;
}

const percent = (r: { usedBytes: number; capacityBytes: number }): number => (r.capacityBytes > 0 ? Math.round((r.usedBytes / r.capacityBytes) * 100) : 0);

/** One lane of cells; `moving` slides it in from `from` px above (a scavenge's survivors or promoted cells arriving). `hot` cells are the promoted ones. */
function Lane({ name, filled, hot = 0, estimate, moving = false, from = 0, children }: { name: string; filled: number; hot?: number; estimate: string; moving?: boolean; from?: number; children?: ReactNode }) {
  const ref = useEnterMotion<HTMLDivElement>(moving, { y: -from });
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-28 shrink-0 flex-col text-xs text-muted-foreground">
        <span>{name}</span>
        {children}
      </span>
      <div ref={ref} role="img" aria-label={`${name}: ${filled} of ${CELLS} cells filled`} className="grid min-w-0 flex-1 grid-cols-[repeat(64,minmax(0,1fr))] gap-px">
        {Array.from({ length: CELLS }, (_, i) => (
          <span key={i} className={`h-3 rounded-[1px] ${i < filled ? (i >= filled - hot ? "bg-foreground" : "bg-muted-foreground") : "bg-secondary"}`} />
        ))}
      </div>
      <span className="w-24 shrink-0 text-right font-mono text-xs text-muted-foreground">{estimate}</span>
    </div>
  );
}

/** The young generation (from and to semi-spaces) and the old one as rows of cells; `fresh` marks the tick a collection happened on. */
export function HeapStripView({ heap, fresh }: { heap: DeepReadonly<V8Snapshot["heap"]>; fresh: boolean }) {
  const strip = heapStrip(heap, CELLS);
  const gc = strip.lastGc;
  const empty = heap.young.objectCount === 0 && heap.old.objectCount === 0 && gc === null;
  const seen = gc ? gc.survivedObjects + gc.freedObjects + gc.promotedObjects : 0;
  const promotedCells = gc && seen > 0 && gc.promotedObjects > 0 ? Math.min(strip.old, Math.max(1, Math.round((gc.promotedObjects / seen) * CELLS))) : 0;
  const summary = `young ${percent(heap.young)}% · old ${percent(heap.old)}% · ${gc ? `last GC: ${gc.type}` : "no GC yet"}`;

  return (
    <Panel label="Heap" summary={summary} badge={<TruthBadge level="illustrative" />} caption={gc ? CAPTION : `${CAPTION} ${NO_GC}`}>
      {empty ? (
        <p className="text-xs text-muted-foreground">Nothing allocated yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {gc ? (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1 text-card-foreground">
                <Recycle aria-hidden="true" className="size-3" />
                {gc.type}
              </span>
              <span>{`freed ${gc.freedObjects} · survived ${gc.survivedObjects} · promoted ${gc.promotedObjects}`}</span>
            </p>
          ) : null}
          <Lane name="Young · from" filled={strip.young.from} estimate={`${bytes(heap.young.usedBytes)} / ${bytes(heap.young.capacityBytes)}`} />
          <Lane name="Young · to" filled={strip.young.to} estimate={gc ? `${gc.survivedObjects} survived` : "—"} moving={fresh && strip.young.to > 0} from={18} />
          <Lane
            name="Old"
            filled={strip.old}
            hot={promotedCells}
            estimate={`${bytes(heap.old.usedBytes)} / ${bytes(heap.old.capacityBytes)}`}
            moving={fresh && promotedCells > 0}
            from={36}
          >
            {promotedCells > 0 ? <span className="text-foreground">promoted</span> : null}
          </Lane>
        </div>
      )}
    </Panel>
  );
}

export function HeapStrip() {
  const heap = useV8State()?.heap ?? EMPTY_HEAP;
  return <HeapStripView heap={heap} fresh={useGcFresh()} />;
}
