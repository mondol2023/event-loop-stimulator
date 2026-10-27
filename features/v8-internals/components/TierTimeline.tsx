"use client";

import { ArrowDownToLine } from "lucide-react";
import { useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { DEOPTIMIZE_REASON_MESSAGES, type Tier } from "@/core/interpreter/tiering/TieringModel";
import type { TierTrack } from "@/core/interpreter/tiering/tierTimeline";
import { TruthBadge } from "@/features/playground/components/TruthBadge";
import { usePlaygroundStore } from "@/features/playground/store/PlaygroundContext";
import { Panel } from "./Panel";

const ROW_LIMIT = 50;
const TRACK_W = 480;
const TRACK_H = 20;
const MARKER = 14;
const INITIAL_MIN_W = 16;

const TIER_ORDER = "Ignition → Sparkplug → Maglev → TurboFan";

function tierWord(tier: Tier): string {
  switch (tier) {
    case "ignition":
      return "Ignition";
    case "sparkplug":
      return "Sparkplug";
    case "maglev":
      return "Maglev";
    case "turbofan":
      return "TurboFan";
    default:
      return tier satisfies never;
  }
}

// A neutral ramp, so tiers never depend on hue and green stays "current" and red "deopt" (design brief §9).
function tierFill(tier: Tier): { rect: string; text: string } {
  switch (tier) {
    case "ignition":
      return { rect: "fill-secondary", text: "fill-foreground" };
    case "sparkplug":
      return { rect: "fill-muted-foreground/50", text: "fill-foreground" };
    case "maglev":
      return { rect: "fill-muted-foreground", text: "fill-background" };
    case "turbofan":
      return { rect: "fill-foreground", text: "fill-background" };
    default:
      return tier satisfies never;
  }
}

function TrackRow({ track, ticks, playhead }: { track: TierTrack; ticks: number; playhead: number | null }) {
  const x = (index: number): number => (ticks <= 1 ? 0 : (Math.min(index, ticks - 1) / (ticks - 1)) * TRACK_W);
  const name = track.functionName === "" ? "(anonymous)" : track.functionName;
  const label = `${name}: ${track.segments.map((s) => `${tierWord(s.tier)} from tick ${s.from}`).join(", ")}`;
  return (
    <li className="flex items-center gap-2">
      <span className="w-28 shrink-0 truncate font-mono text-xs text-card-foreground" title={name}>
        {name}
      </span>
      <svg viewBox={`0 0 ${TRACK_W} ${TRACK_H}`} role="group" aria-label={label} className="h-auto w-full min-w-80 flex-1">
        {track.segments.map((seg, i) => {
          const start = x(seg.from);
          const end = i + 1 < track.segments.length ? x(track.segments[i + 1]?.from ?? ticks) : TRACK_W;
          const width = Math.max(end - start, 2);
          const fill = tierFill(seg.tier);
          return (
            <g key={`${seg.from}:${seg.tier}`}>
              <rect x={start} y={2} width={width} height={TRACK_H - 4} className={`${fill.rect} stroke-border`} strokeWidth={0.5} />
              {width >= INITIAL_MIN_W ? (
                <text x={start + width / 2} y={TRACK_H / 2 + 3.5} textAnchor="middle" aria-hidden="true" className={`${fill.text} font-mono text-[10px] font-medium`}>
                  {tierWord(seg.tier).slice(0, 1)}
                </text>
              ) : null}
            </g>
          );
        })}
        {playhead === null ? null : <line data-playhead x1={x(playhead)} x2={x(playhead)} y1={0} y2={TRACK_H} strokeWidth={1.5} className="stroke-primary" />}
        {track.deopts.map((deopt) => {
          const reason = DEOPTIMIZE_REASON_MESSAGES[deopt.reason];
          const at = Math.min(Math.max(x(deopt.index), MARKER / 2), TRACK_W - MARKER / 2) - MARKER / 2;
          return (
            <g key={`${deopt.index}:${deopt.reason}`} role="img" tabIndex={0} aria-label={`Deoptimized: ${reason}`} className="outline-none focus-visible:[&>rect]:stroke-ring">
              <title>{reason}</title>
              <rect x={at} y={(TRACK_H - MARKER) / 2} width={MARKER} height={MARKER} rx={3} strokeWidth={1.5} className="fill-destructive stroke-transparent" />
              <ArrowDownToLine x={at + 2} y={(TRACK_H - MARKER) / 2 + 2} width={MARKER - 4} height={MARKER - 4} strokeWidth={2.5} aria-hidden="true" className="stroke-background" />
            </g>
          );
        })}
      </svg>
    </li>
  );
}

/** Where V8 would typically move each function between tiers, across the whole run: a Modeled guess, not a recording (D5). */
export function TierTimeline() {
  const store = usePlaygroundStore();
  const tracks = useStore(store, (s) => s.compile.tierTracks);
  const length = useStore(store, (s) => s.playback.length);
  const index = useStore(store, (s) => s.playback.index);
  const [showAll, setShowAll] = useState(false);

  const deopts = tracks.reduce((sum, t) => sum + t.deopts.length, 0);
  // The tick axis spans the run; a track that names a later tick (a fresh run still loading) widens it rather than overflow.
  const last = tracks.reduce((m, t) => Math.max(m, ...t.segments.map((s) => s.from), ...t.deopts.map((d) => d.index)), 0);
  const ticks = Math.max(length, last + 1);
  const rows = showAll ? tracks : tracks.slice(0, ROW_LIMIT);

  return (
    <Panel
      label="V8 would typically tier up here"
      summary={tracks.length === 0 ? undefined : `${tracks.length} ${tracks.length === 1 ? "function" : "functions"} · ${deopts} ${deopts === 1 ? "deopt" : "deopts"}`}
      badge={<TruthBadge level="modeled" />}
    >
      {tracks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No function got hot enough to tier up: V8 would typically keep running it in Ignition, the bytecode interpreter.</p>
      ) : (
        <>
          <div className="max-h-64 overflow-auto">
            <ul role="list" className="m-0 flex min-w-fit list-none flex-col gap-1 p-0">
              {rows.map((track) => (
                <TrackRow key={track.functionId} track={track} ticks={ticks} playhead={length > 0 ? index : null} />
              ))}
            </ul>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{TIER_ORDER}</span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex size-4 items-center justify-center rounded-sm bg-destructive text-background">
                <ArrowDownToLine aria-hidden="true" className="size-3" />
              </span>
              deopt: hover or focus for the reason
            </span>
          </p>
        </>
      )}
      {!showAll && tracks.length > ROW_LIMIT ? (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setShowAll(true)}>
          {`Show all ${tracks.length}`}
        </Button>
      ) : null}
    </Panel>
  );
}
