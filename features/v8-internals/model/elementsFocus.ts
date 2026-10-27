import type { ElementsKind } from "@/core/runtime/objects/ElementsKind";

type Kinds = Readonly<Record<number, ElementsKind>>;
type KindsAt = (index: number) => { readonly v8: { readonly elementsKinds: Kinds } };
export type ElementsFocus = { objectId: number; kind: ElementsKind };

/** The newest object whose kind in `now` is new or differs from `before`. */
function changeBetween(now: Kinds, before: Kinds): ElementsFocus | null {
  let newest: number | null = null;
  for (const key of Object.keys(now)) {
    const id = Number(key);
    if (now[id] !== before[id] && (newest === null || id > newest)) newest = id;
  }
  const kind = newest === null ? undefined : now[newest];
  return newest !== null && kind !== undefined ? { objectId: newest, kind } : null;
}

/**
 * Walks back from tick `from` (whose kinds are `nowAtFrom`) to tick `downTo`, returning the first change found.
 * Each tick is fetched once: the kinds just read as "before" are the next step's "now". `knownBefore`, when given,
 * is the already-known kinds of tick `downTo - 1`.
 */
function scan(at: KindsAt, from: number, nowAtFrom: Kinds, downTo: number, knownBefore?: Kinds): ElementsFocus | null {
  let now = nowAtFrom;
  for (let tick = from; tick >= downTo; tick--) {
    const before = tick === downTo && knownBefore ? knownBefore : tick > 0 ? at(tick - 1).v8.elementsKinds : {};
    const change = changeBetween(now, before);
    if (change) return change;
    now = before;
  }
  return null;
}

/** The newest object whose elements kind was created or changed at tick `index` or before it, and that kind. */
export function latestChangedElements(at: KindsAt, index: number): ElementsFocus | null {
  const now = at(index).v8.elementsKinds;
  // Nothing has an elements kind yet, so there is nothing earlier to find.
  return Object.keys(now).length === 0 ? null : scan(at, index, now, 0);
}

/**
 * `latestChangedElements` for a cursor that mostly moves one tick forward: stepping reads only the new tick, a forward
 * jump reads only the ticks it skipped, and only a backward seek or a new timeline pays the full walk. Keeps playback
 * linear on long runs and leaves the timeline's small LRU to the panels that need it.
 */
export class ElementsFocusTracker {
  #source: object | null = null;
  #index = -1;
  #kinds: Kinds = {};
  #focus: ElementsFocus | null = null;

  /** `source` is the timeline's identity: a different one starts over. */
  resolve(source: object, at: KindsAt, index: number): ElementsFocus | null {
    const sameRun = source === this.#source;
    if (sameRun && index === this.#index) return this.#focus;
    const now = at(index).v8.elementsKinds;
    let focus: ElementsFocus | null;
    if (Object.keys(now).length === 0) focus = null;
    else if (sameRun && index > this.#index) focus = scan(at, index, now, this.#index + 1, this.#kinds) ?? this.#focus;
    else focus = scan(at, index, now, 0);
    this.#source = source;
    this.#index = index;
    this.#kinds = now;
    this.#focus = focus;
    return focus;
  }
}
