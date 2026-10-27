import type { ElementsKind } from "@/core/runtime/objects/ElementsKind";

export type LatticeNode = { kind: ElementsKind; x: number; y: number; current: boolean; reachable: boolean };
export type LatticeEdge = { from: ElementsKind; to: ElementsKind };

// SMI -> DOUBLE -> tagged, PACKED -> HOLEY, anything -> DICTIONARY; nothing goes back (V8 elements-kind.cc).
const KINDS = [
  "PACKED_SMI_ELEMENTS",
  "PACKED_DOUBLE_ELEMENTS",
  "PACKED_ELEMENTS",
  "HOLEY_SMI_ELEMENTS",
  "HOLEY_DOUBLE_ELEMENTS",
  "HOLEY_ELEMENTS",
  "DICTIONARY_ELEMENTS",
] as const satisfies readonly ElementsKind[];

/** Packed on the top row, holey below, dictionary at the right of the bottom row, on a grid. */
function position(kind: ElementsKind): { x: number; y: number } {
  switch (kind) {
    case "PACKED_SMI_ELEMENTS":
      return { x: 0, y: 0 };
    case "PACKED_DOUBLE_ELEMENTS":
      return { x: 1, y: 0 };
    case "PACKED_ELEMENTS":
      return { x: 2, y: 0 };
    case "HOLEY_SMI_ELEMENTS":
      return { x: 0, y: 1 };
    case "HOLEY_DOUBLE_ELEMENTS":
      return { x: 1, y: 1 };
    case "HOLEY_ELEMENTS":
      return { x: 2, y: 1 };
    case "DICTIONARY_ELEMENTS":
      return { x: 3, y: 1 };
    default:
      return kind satisfies never;
  }
}

const EDGES: readonly LatticeEdge[] = [
  { from: "PACKED_SMI_ELEMENTS", to: "PACKED_DOUBLE_ELEMENTS" },
  { from: "PACKED_DOUBLE_ELEMENTS", to: "PACKED_ELEMENTS" },
  { from: "HOLEY_SMI_ELEMENTS", to: "HOLEY_DOUBLE_ELEMENTS" },
  { from: "HOLEY_DOUBLE_ELEMENTS", to: "HOLEY_ELEMENTS" },
  { from: "PACKED_SMI_ELEMENTS", to: "HOLEY_SMI_ELEMENTS" },
  { from: "PACKED_DOUBLE_ELEMENTS", to: "HOLEY_DOUBLE_ELEMENTS" },
  { from: "PACKED_ELEMENTS", to: "HOLEY_ELEMENTS" },
  ...KINDS.filter((k) => k !== "DICTIONARY_ELEMENTS").map((from): LatticeEdge => ({ from, to: "DICTIONARY_ELEMENTS" })),
];

/** `reachable` includes the current kind itself; with no current kind nothing is reachable. */
export function latticeModel(current: ElementsKind | null): { nodes: LatticeNode[]; edges: LatticeEdge[] } {
  const reachable = new Set<ElementsKind>();
  if (current !== null) {
    const queue: ElementsKind[] = [current];
    for (let kind = queue.shift(); kind !== undefined; kind = queue.shift()) {
      if (reachable.has(kind)) continue;
      reachable.add(kind);
      for (const e of EDGES) if (e.from === kind) queue.push(e.to);
    }
  }
  return {
    nodes: KINDS.map((kind) => ({ kind, ...position(kind), current: kind === current, reachable: reachable.has(kind) })),
    edges: EDGES.map((e) => ({ ...e })),
  };
}
