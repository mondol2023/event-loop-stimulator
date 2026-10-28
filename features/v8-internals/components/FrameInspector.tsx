"use client";

import { Box, CircleDashed, Hash, Lock, type LucideIcon } from "lucide-react";
import { useStore } from "zustand";
import { useConsoleHidden } from "@/features/playground/hooks/useConsoleHidden";
import { useCallStack } from "@/features/playground/hooks/useTickSelectors";
import { usePlaygroundStore } from "@/features/playground/store/PlaygroundContext";
import { TruthBadge } from "@/features/playground/components/TruthBadge";
import { frameRows, type FrameRow } from "../model/frameRows";
import { MapChip, Panel } from "./Panel";

function tagIcon(tag: FrameRow["tag"]): LucideIcon {
  switch (tag) {
    case "Smi":
      return Hash;
    case "HeapObject":
      return Box;
    case "Oddball":
      return CircleDashed;
    case "internal":
      return Lock;
    default:
      return tag satisfies never;
  }
}

const EMPTY = "text-xs text-muted-foreground";

/** What V8 holds for the top frame right now: the accumulator and registers, each tagged as V8 tags them (ADR-039). */
export function FrameInspector() {
  const callStack = useCallStack();
  const { hidden } = useConsoleHidden();
  const ticks = useStore(usePlaygroundStore(), (s) => s.playback.length);
  const frame = callStack.at(-1);
  const badge = <TruthBadge level="verified-model" />;

  if (ticks === 0) {
    return (
      <Panel label="Frame" badge={badge}>
        <p className={EMPTY}>Registers appear when your code runs. Press Play or step forward.</p>
      </Panel>
    );
  }
  if (!frame) {
    return (
      <Panel label="Frame" badge={badge}>
        <p className={EMPTY}>No JavaScript frame right now: the call stack is empty while Node&apos;s loop picks the next task.</p>
      </Panel>
    );
  }

  const rows = frameRows(frame, { predictFirst: hidden });
  const values = [frame.accumulator, ...frame.registers];
  const [accumulator, ...registers] = rows;
  const renderRow = (row: FrameRow, index: number, pinned: boolean) => {
    const value = values[index];
    const Icon = tagIcon(row.tag);
    // D7: only strings and object previews are masked; say what the cell hides, since "…" alone says nothing.
    const masked = hidden && (value?.kind === "string" || value?.kind === "object") ? value.kind : null;
    return (
      <tr key={row.name} className={pinned ? "sticky top-6 bg-panel" : undefined}>
        <th scope="row" className="py-0.5 pr-3 text-left font-normal text-muted-foreground">
          {row.name}
        </th>
        <td className="py-0.5 pr-3">
          {masked ? (
            <>
              <span aria-hidden="true">{row.text}</span>
              <span className="sr-only">{`${masked}, hidden until you reveal`}</span>
            </>
          ) : (
            row.text
          )}
          {value?.kind === "object" ? (
            <span className="ml-2">
              <MapChip id={value.mapId} />
            </span>
          ) : null}
        </td>
        <td className="py-0.5 pr-3 whitespace-nowrap">
          <span className="inline-flex items-center gap-1">
            <Icon aria-hidden="true" className="size-3 text-muted-foreground" />
            {row.tag}
          </span>
        </td>
        <td className="py-0.5">{row.tagged ?? "—"}</td>
      </tr>
    );
  };

  return (
    <Panel
      label="Frame"
      summary={
        <>
          <span className="font-mono">{frame.functionName === "" ? "(anonymous)" : frame.functionName}</span>
          {` · offset ${frame.bytecodeOffset} · context #${frame.contextId}`}
        </>
      }
      badge={badge}
      caption="Values are exact; the tagging is our verified model."
    >
      {/* Keyboard users scroll the table through its focusable box (axe: scrollable-region-focusable). */}
      <div role="group" aria-label="Registers" tabIndex={0} className="max-h-56 overflow-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <table className="w-full font-mono text-xs tabular-nums">
          <caption className="sr-only">Accumulator and registers of the top frame</caption>
          <thead className="sticky top-0 bg-panel text-left text-muted-foreground">
            <tr className="h-6">
              <th scope="col" className="pr-3 font-normal">
                Register
              </th>
              <th scope="col" className="pr-3 font-normal">
                Value
              </th>
              <th scope="col" className="pr-3 font-normal">
                Tag
              </th>
              <th scope="col" className="font-normal">
                Tagged word
              </th>
            </tr>
          </thead>
          <tbody>
            {accumulator ? renderRow(accumulator, 0, true) : null}
            {registers.map((row, n) => renderRow(row, n + 1, false))}
          </tbody>
        </table>
      </div>
      {registers.length === 0 ? <p className={EMPTY}>This function needs only the accumulator.</p> : null}
    </Panel>
  );
}
