"use client";

import { useId } from "react";
import type { ElementsKind } from "@/core/runtime/objects/ElementsKind";
import { TruthBadge } from "@/features/playground/components/TruthBadge";
import { useElementsFocus } from "../hooks/useElementsFocus";
import { latticeModel, type LatticeNode } from "../model/latticeModel";
import { Panel } from "./Panel";

// The SVG is 4 columns of 160 by 2 rows of 60 units; the <li> nodes sit over it in the same cells, placed by class (the CSP forbids style attributes).
const CELL_W = 160;
const CELL_H = 60;
const NODE_W = 134;
const NODE_H = 36;
const centerX = (x: number): number => x * CELL_W + CELL_W / 2;
const centerY = (y: number): number => y * CELL_H + CELL_H / 2;

const LEFT = ["left-0", "left-1/4", "left-1/2", "left-3/4"] as const;
const TOP = ["top-0", "top-1/2"] as const;

/** An edge between two nodes: straight when they touch, else a dashed rail that joins at the dictionary node. */
function edgePath(from: LatticeNode, to: LatticeNode): string {
  const fx = centerX(from.x);
  const fy = centerY(from.y);
  const tx = centerX(to.x);
  const ty = centerY(to.y);
  const adjacent = Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1;
  if (adjacent) {
    if (from.y === to.y) return `M ${fx + NODE_W / 2} ${fy} L ${tx - NODE_W / 2 - 2} ${ty}`;
    return `M ${fx} ${fy + NODE_H / 2} L ${tx} ${ty - NODE_H / 2 - 2}`;
  }
  // Packed kinds leave through the top and holey ones through the bottom, so no rail runs through another node.
  if (from.y === 0) return `M ${fx} ${fy - NODE_H / 2} V 4 H ${tx} V ${ty - NODE_H / 2 - 2}`;
  return `M ${fx} ${fy + NODE_H / 2} V ${2 * CELL_H - 2} H ${tx} V ${ty + NODE_H / 2 + 2}`;
}

const EMPTY = "No arrays yet: create one and its elements kind lights up here. Kinds only ever move one way, toward the more general.";

/** The seven elements kinds as V8 moves arrays between them, one way only, with the kind of the array that changed last lit (elements-kind.cc). */
export function ElementsLattice() {
  const focus = useElementsFocus();
  const markerId = useId();
  const badge = <TruthBadge level="verified-model" />;
  if (!focus) {
    return (
      <Panel label="Elements kinds" badge={badge}>
        <p className="text-xs text-muted-foreground">{EMPTY}</p>
      </Panel>
    );
  }
  const { nodes, edges } = latticeModel(focus.kind);
  const byKind = new Map<ElementsKind, LatticeNode>(nodes.map((n) => [n.kind, n]));
  return (
    <Panel label="Elements kinds" summary={`object #${focus.objectId} (changed last)`} badge={badge}>
      <div className="overflow-x-auto">
        <div className="relative aspect-[16/3] w-full min-w-[40rem]">
          <svg viewBox={`0 0 ${4 * CELL_W} ${2 * CELL_H}`} aria-hidden="true" focusable="false" className="absolute inset-0 size-full fill-none">
            <defs>
              <marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const from = byKind.get(edge.from);
              const to = byKind.get(edge.to);
              if (!from || !to) return null;
              const rail = Math.abs(from.x - to.x) + Math.abs(from.y - to.y) !== 1;
              return (
                <path
                  key={`${edge.from}>${edge.to}`}
                  d={edgePath(from, to)}
                  markerEnd={`url(#${markerId})`}
                  strokeWidth={1.25}
                  strokeDasharray={rail ? "4 3" : undefined}
                  className={from.reachable ? "stroke-muted-foreground" : "stroke-border"}
                />
              );
            })}
          </svg>
          <ol className="absolute inset-0 m-0 list-none p-0">
            {nodes.map((node) => (
              <li
                key={node.kind}
                aria-current={node.current ? "true" : undefined}
                className={`absolute flex h-1/2 w-1/4 items-center justify-center ${LEFT[node.x] ?? "left-0"} ${TOP[node.y] ?? "top-0"}`}
              >
                <div
                  className={`flex h-3/5 w-[84%] flex-col items-center justify-center rounded-md border text-center ${
                    node.current
                      ? "border-primary bg-primary/15 text-foreground"
                      : node.reachable
                        ? "border-border bg-card text-card-foreground"
                        : "border-dashed border-border bg-card text-muted-foreground"
                  }`}
                >
                  <span data-kind className="font-mono text-[10px] leading-tight">
                    {node.kind}
                  </span>
                  {node.current ? <span className="text-[10px] leading-tight font-medium">current</span> : null}
                  {!node.reachable ? <span className="text-[10px] leading-tight">(no way back)</span> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Dimmed: no way back from the current kind.</p>
    </Panel>
  );
}
