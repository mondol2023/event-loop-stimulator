import type { MapSnapshot } from "@/core/timeline/Tick";
import type { MapId } from "@/core/shared/ids";

export type TransitionNode = { id: MapId; x: number; y: number; label: string; dictionary: boolean; deprecated: boolean; current: boolean };
export type TransitionEdge = { from: MapId; to: MapId; key: string };

/** The field a child Map added: its last field not in the parent's. */
function addedKey(child: MapSnapshot, parent: MapSnapshot | undefined): string {
  const known = new Set(parent?.fields.map((f) => f.key));
  const added = child.fields.filter((f) => !known.has(f.key));
  return (added.at(-1) ?? child.fields.at(-1))?.key ?? "";
}

/** Which Maps survive the cap: the focus and its ancestors first, then nearest neighbors (parent or child) outward, by id. */
function keep(maps: readonly MapSnapshot[], byId: ReadonlyMap<MapId, MapSnapshot>, focus: MapId | undefined, cap: number): Set<MapId> {
  const children = new Map<MapId, MapId[]>();
  for (const m of maps) {
    if (m.backPointer === null) continue;
    const list = children.get(m.backPointer) ?? [];
    list.push(m.id);
    children.set(m.backPointer, list);
  }
  const start = focus !== undefined && byId.has(focus) ? focus : maps.find((m) => m.backPointer === null || !byId.has(m.backPointer))?.id;
  const kept = new Set<MapId>();
  if (start === undefined) return kept;
  const chain: MapId[] = [];
  for (let at: MapId | null | undefined = start; at !== null && at !== undefined && byId.has(at) && !chain.includes(at); at = byId.get(at)?.backPointer) chain.push(at);
  for (const id of chain.slice(0, cap)) kept.add(id);
  const queue = [...kept];
  for (let id = queue.shift(); id !== undefined && kept.size < cap; id = queue.shift()) {
    const parent = byId.get(id)?.backPointer;
    const next = [...(parent !== null && parent !== undefined ? [parent] : []), ...(children.get(id) ?? []).slice().sort((a, b) => a - b)];
    for (const n of next) {
      if (kept.size >= cap) break;
      if (byId.has(n) && !kept.has(n)) {
        kept.add(n);
        queue.push(n);
      }
    }
  }
  return kept;
}

// A tidy tree from `backPointer`: x is the leaf order (a parent sits over its first and last child), y is the depth.
export function transitionLayout(maps: readonly MapSnapshot[], focus?: MapId, cap = 128): { nodes: TransitionNode[]; edges: TransitionEdge[]; hidden: number } {
  const byId = new Map(maps.map((m) => [m.id, m]));
  const kept = maps.length > cap ? keep(maps, byId, focus, cap) : new Set(maps.map((m) => m.id));
  const shown = maps.filter((m) => kept.has(m.id)).sort((a, b) => a.id - b.id);

  const children = new Map<MapId, MapSnapshot[]>();
  const roots: MapSnapshot[] = [];
  for (const m of shown) {
    if (m.backPointer !== null && kept.has(m.backPointer)) {
      const list = children.get(m.backPointer) ?? [];
      list.push(m);
      children.set(m.backPointer, list);
    } else roots.push(m);
  }

  const nodes: TransitionNode[] = [];
  const edges: TransitionEdge[] = [];
  let leaf = 0;
  const place = (m: MapSnapshot, depth: number): number => {
    const kids = children.get(m.id) ?? [];
    const xs = kids.map((k) => {
      edges.push({ from: m.id, to: k.id, key: addedKey(k, m) });
      return place(k, depth + 1);
    });
    const x = xs.length === 0 ? leaf++ : Math.floor(((xs[0] ?? 0) + (xs.at(-1) ?? 0)) / 2);
    nodes.push({
      id: m.id,
      x,
      y: depth,
      label: m.backPointer === null ? "root" : addedKey(m, byId.get(m.backPointer)) || `#${m.id}`,
      dictionary: m.isDictionary,
      deprecated: m.deprecated,
      current: m.id === focus,
    });
    return x;
  };
  for (const root of roots) place(root, 0);
  nodes.sort((a, b) => a.id - b.id);
  return { nodes, edges, hidden: maps.length - nodes.length };
}
