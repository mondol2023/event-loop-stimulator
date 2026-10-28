"use client";

import { Network, Table2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MapId } from "@/core/shared/ids";
import type { Tick } from "@/core/timeline/Tick";
import { useCallStack, useV8State } from "@/features/playground/hooks/useTickSelectors";
import { TruthBadge } from "@/features/playground/components/TruthBadge";
import { useEnterMotion } from "../hooks/useEnterMotion";
import { transitionLayout, type TransitionEdge, type TransitionNode } from "../model/transitionLayout";
import { Panel } from "./Panel";

const NO_MAPS: Tick["v8"]["maps"] = [];

// The tree grows to the right (docs/design/internals-hardware-shape.md §5): depth is the column, leaf order the row.
const NODE_W = 124;
const NODE_H = 40;
const GAP_X = 88;
const GAP_Y = 12;
const PAD = 8;
const FLAG_CHAR_W = 5.4;
const KEY_MAX = 11;

const left = (n: TransitionNode): number => PAD + n.y * (NODE_W + GAP_X);
const top = (n: TransitionNode): number => PAD + n.x * (NODE_H + GAP_Y);
const truncate = (key: string): string => (key.length > KEY_MAX ? `${key.slice(0, KEY_MAX - 1)}…` : key);
const flagsOf = (n: TransitionNode): string[] => [...(n.current ? ["current"] : []), ...(n.dictionary ? ["dictionary"] : []), ...(n.deprecated ? ["deprecated"] : [])];

function edgePath(from: TransitionNode, to: TransitionNode): string {
  const x1 = left(from) + NODE_W;
  const y1 = top(from) + NODE_H / 2;
  const x2 = left(to) - 2;
  const y2 = top(to) + NODE_H / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

/** One Map: the id, its field count, and a word for each flag so no state rides on color or a dash alone. */
function GraphNode({ node, fields }: { node: TransitionNode; fields: number }) {
  // Only the Map that just became current slides in; a jump to a later tick must not replay every node.
  const ref = useEnterMotion<SVGGElement>(node.current, { x: -8 });
  const x = left(node);
  const y = top(node);
  const flags = flagsOf(node);
  return (
    <g ref={ref} aria-current={node.current ? "true" : undefined} data-map-id={node.id}>
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={6}
        strokeWidth={node.current ? 2 : 1}
        strokeDasharray={node.dictionary ? "4 3" : undefined}
        className={node.current ? "fill-primary/15 stroke-primary" : "fill-card stroke-border"}
      />
      <text x={x + 6} y={y + 14} className={`fill-card-foreground font-mono text-[11px] ${node.deprecated ? "line-through" : ""}`}>{`Map#${node.id}`}</text>
      <text x={x + 6} y={y + 26} className="fill-muted-foreground text-[9px]">{`${fields} ${fields === 1 ? "field" : "fields"}`}</text>
      {flags.map((flag, i) => {
        const at = x + 6 + flags.slice(0, i).reduce((sum, f) => sum + f.length * FLAG_CHAR_W + 6, 0);
        return (
          <text key={flag} x={at} y={y + 36} className={`font-mono text-[9px] ${flag === "current" ? "fill-primary" : "fill-muted-foreground"}`}>
            {flag}
          </text>
        );
      })}
    </g>
  );
}

function Graph({ nodes, edges, fieldCount, summary }: { nodes: readonly TransitionNode[]; edges: readonly TransitionEdge[]; fieldCount: ReadonlyMap<MapId, number>; summary: string }) {
  const markerId = useId();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const width = PAD * 2 + (Math.max(...nodes.map((n) => n.y)) + 1) * (NODE_W + GAP_X) - GAP_X;
  const height = PAD * 2 + (Math.max(...nodes.map((n) => n.x)) + 1) * (NODE_H + GAP_Y) - GAP_Y;
  const scroller = useRef<HTMLDivElement>(null);
  const currentId = nodes.find((n) => n.current)?.id;

  // Bring the current node into view only if it left the viewport; "auto" is instant, so reduced motion needs no branch (design brief §5).
  useEffect(() => {
    const el = scroller.current?.querySelector('[aria-current="true"]');
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
  }, [currentId]);

  return (
    <div ref={scroller} role="group" aria-label="Hidden-class graph" tabIndex={0} className="max-h-72 overflow-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} className="max-w-none fill-none">
        <defs>
          <marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          return (
            <g key={`${edge.from}>${edge.to}`}>
              <path d={edgePath(from, to)} strokeWidth={1.25} markerEnd={`url(#${markerId})`} className="stroke-muted-foreground" />
              <title>{edge.key}</title>
              <text data-edge-label x={left(to) - GAP_X / 2} y={top(to) + NODE_H / 2 - 4} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
                {truncate(edge.key)}
              </text>
            </g>
          );
        })}
        {nodes.map((node) => (
          <GraphNode key={node.id} node={node} fields={fieldCount.get(node.id) ?? 0} />
        ))}
      </svg>
    </div>
  );
}

/** The same Maps as the graph, as a table: the text alternative (a11y brief §13). */
function MapTable({ nodes, edges, fieldCount }: { nodes: readonly TransitionNode[]; edges: readonly TransitionEdge[]; fieldCount: ReadonlyMap<MapId, number> }) {
  const parentOf = new Map(edges.map((e) => [e.to, e]));
  return (
    <div role="group" aria-label="Maps" tabIndex={0} className="max-h-72 overflow-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <table className="w-full font-mono text-xs">
        <caption className="sr-only">Maps and the transitions between them</caption>
        <thead className="sticky top-0 bg-panel text-left text-muted-foreground">
          <tr className="h-6">
            {["Map", "Parent", "Added key", "Fields", "Flags"].map((name) => (
              <th key={name} scope="col" className="pr-3 font-normal">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => {
            const edge = parentOf.get(node.id);
            const flags = flagsOf(node);
            return (
              <tr key={node.id} aria-current={node.current ? "true" : undefined} className={node.current ? "bg-primary/15 shadow-[inset_3px_0_0_var(--primary)]" : undefined}>
                <td className={`py-0.5 pr-3 ${node.deprecated ? "line-through" : ""}`}>{`Map#${node.id}`}</td>
                <td className="py-0.5 pr-3">{edge ? `Map#${edge.from}` : "—"}</td>
                <td className="py-0.5 pr-3">{edge ? edge.key : "—"}</td>
                <td className="py-0.5 pr-3">{fieldCount.get(node.id) ?? 0}</td>
                <td className="py-0.5 whitespace-nowrap">{flags.length === 0 ? "—" : flags.join(", ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type View = "graph" | "table";

/** The shapes (hidden classes) V8 gave the program's objects, as the tree of transitions between them (PROMPT §8.3). */
export function HiddenClassGraph() {
  const v8 = useV8State();
  const accumulator = useCallStack().at(-1)?.accumulator;
  // Phones open on the Table (shape brief §3); the tab is client-only, so matchMedia is safe here.
  const [view, setView] = useState<View>(() => (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches ? "table" : "graph"));
  const maps = v8?.maps ?? NO_MAPS;
  // The Map this tick created or changed; else the Map of the object in the accumulator.
  const current = v8?.changedMapId ?? (accumulator?.kind === "object" ? accumulator.mapId : undefined);

  const layout = useMemo(() => transitionLayout(maps, current), [maps, current]);
  const fieldCount = useMemo(() => new Map<MapId, number>(maps.map((m) => [m.id, m.fields.length])), [maps]);
  const { nodes, edges, hidden } = layout;
  const currentNode = nodes.find((n) => n.current);
  const summary = `${maps.length} ${maps.length === 1 ? "Map" : "Maps"}${currentNode ? ` · current Map#${currentNode.id}` : ""}`;

  return (
    <Panel
      label="Hidden classes"
      summary={nodes.length === 0 ? undefined : summary}
      badge={<TruthBadge level="verified-model" />}
    >
      {nodes.length === 0 ? null : (
        <div role="group" aria-label="View" className="flex gap-0.5">
          <Button type="button" variant={view === "graph" ? "secondary" : "ghost"} size="xs" aria-pressed={view === "graph"} onClick={() => setView("graph")}>
            <Network aria-hidden="true" />
            Graph
          </Button>
          <Button type="button" variant={view === "table" ? "secondary" : "ghost"} size="xs" aria-pressed={view === "table"} onClick={() => setView("table")}>
            <Table2 aria-hidden="true" />
            Table
          </Button>
        </div>
      )}
      {nodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No objects yet: hidden classes appear when your code creates one.</p>
      ) : view === "graph" ? (
        <Graph nodes={nodes} edges={edges} fieldCount={fieldCount} summary={`Hidden-class transition tree, ${summary}. The Table view lists the same Maps.`} />
      ) : (
        <MapTable nodes={nodes} edges={edges} fieldCount={fieldCount} />
      )}
      {hidden > 0 ? <p className="text-xs text-muted-foreground">{`+${hidden} more Maps`}</p> : null}
    </Panel>
  );
}
