import type { ElementsKind } from "@/core/runtime/objects/ElementsKind";

type KindsAt = (index: number) => { readonly v8: { readonly elementsKinds: Readonly<Record<number, ElementsKind>> } };

/** The newest object whose elements kind was created or changed at tick `index` or before it, and that kind. */
export function latestChangedElements(at: KindsAt, index: number): { objectId: number; kind: ElementsKind } | null {
  // Nothing has an elements kind yet, so there is nothing earlier to find.
  if (Object.keys(at(index).v8.elementsKinds).length === 0) return null;
  for (let tick = index; tick >= 0; tick--) {
    const now = at(tick).v8.elementsKinds;
    const before = tick > 0 ? at(tick - 1).v8.elementsKinds : {};
    let newest: number | null = null;
    for (const key of Object.keys(now)) {
      const id = Number(key);
      if (now[id] !== before[id] && (newest === null || id > newest)) newest = id;
    }
    const kind = newest === null ? undefined : now[newest];
    if (newest !== null && kind !== undefined) return { objectId: newest, kind };
  }
  return null;
}
