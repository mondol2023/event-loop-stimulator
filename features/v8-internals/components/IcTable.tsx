"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import type { Tick } from "@/core/timeline/Tick";
import { useV8State } from "@/features/playground/hooks/useTickSelectors";
import { usePlaygroundStore } from "@/features/playground/store/PlaygroundContext";
import { TruthBadge } from "@/features/playground/components/TruthBadge";
import { icRows, type IcRow } from "../model/icRows";
import { MapChip, Panel } from "./Panel";

const ROW_LIMIT = 50;
const NO_FEEDBACK: Tick["v8"]["feedback"] = [];

function stateWord(row: IcRow): string {
  switch (row.state) {
    case "UNINITIALIZED":
      return "uninitialized";
    case "MONOMORPHIC":
      return "monomorphic";
    case "POLYMORPHIC":
      return `polymorphic (${row.mapIds.length})`;
    case "MEGAMORPHIC":
      return "megamorphic";
    default:
      return row.state satisfies never;
  }
}

/** How each feedback slot of every function has seen its receivers; the bytecode pane's `[n]` operands select a row (PROMPT §8.3). */
export function IcTable() {
  const feedback = useV8State()?.feedback ?? NO_FEEDBACK;
  const focusSlot = useStore(usePlaygroundStore(), (s) => s.focusSlot);
  const [showAll, setShowAll] = useState(false);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const all = icRows(feedback, Infinity).rows;
  const total = all.length;
  const isFocus = (row: IcRow): boolean => focusSlot !== null && row.functionId === focusSlot.functionId && row.slot === focusSlot.slot;
  // A linked slot past row 50 would be selected but hidden, so it opens the rest.
  const focusHidden = focusSlot !== null && !all.slice(0, ROW_LIMIT).some(isFocus) && all.some(isFocus);
  const rows = showAll || focusHidden ? all : all.slice(0, ROW_LIMIT);

  // The panel's level is its weakest row's, hidden rows included (design brief §11).
  const weakest = all.some((r) => r.truth === "modeled") ? "modeled" : "verified-model";

  useEffect(() => {
    const row = bodyRef.current?.querySelector('tr[aria-selected="true"]');
    if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [focusSlot]);

  return (
    <Panel label="Inline caches" summary={`${total} ${total === 1 ? "slot" : "slots"}`} badge={<TruthBadge level={weakest} />}>
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">No inline caches yet: they appear once a function with property accesses or calls has run.</p>
      ) : (
        <div className="max-h-56 overflow-auto">
          <table className="w-full font-mono text-xs">
            <caption className="sr-only">Feedback slots and the Maps each has seen</caption>
            <thead className="sticky top-0 bg-panel text-left text-muted-foreground">
              <tr className="h-6">
                {["Function", "Slot", "Kind", "State", "Maps seen", "Truth"].map((name) => (
                  <th key={name} scope="col" className="pr-3 font-normal">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {rows.map((row) => {
                const selected = isFocus(row);
                const name = row.functionName === "" ? "(anonymous)" : row.functionName;
                return (
                  <tr
                    key={`${row.functionId}:${row.slot}`}
                    aria-selected={selected ? true : undefined}
                    className={selected ? "bg-primary/15 shadow-[inset_3px_0_0_var(--primary)]" : undefined}
                  >
                    <td className="max-w-32 truncate py-0.5 pr-3" title={name}>
                      {name}
                    </td>
                    <td className="py-0.5 pr-3">{`[${row.slot}]`}</td>
                    <td className="py-0.5 pr-3">{row.kind}</td>
                    <td className="py-0.5 pr-3 whitespace-nowrap">{stateWord(row)}</td>
                    <td className="py-0.5 pr-3">
                      {row.mapIds.length === 0 ? (
                        "—"
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {row.mapIds.map((id) => (
                            <MapChip key={id} id={id} />
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="py-0.5">
                      <TruthBadge level={row.truth} compact />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!showAll && !focusHidden && total > ROW_LIMIT ? (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setShowAll(true)}>
          {`Show all ${total}`}
        </Button>
      ) : null}
    </Panel>
  );
}
