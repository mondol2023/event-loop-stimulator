import type { Tick } from "./Tick";

// The recorded run, kept small enough to hold and to ship (PROMPT.md §7.5: 5,000 ticks within
// 20 MB). Ticks share their unchanged parts by reference (Decision D6), so tick i is stored as a
// patch over tick i-1 that names only what changed, plus a full keyframe every 64 ticks. Reading
// tick i replays at most 63 patches; an LRU of 256 materialized ticks makes scrubbing cheap.

type Plain = Record<string, unknown>;

/**
 * What changed from the previous tick. Keys are `"console"` for a top-level key or `"v8.heap"` for
 * a key one level down (the top-level objects, like `v8`, change often but only in part).
 */
export type Patch = {
  index: number;
  /** Keys whose value is replaced. */
  set: Record<string, unknown>;
  /** Keys that no longer exist. */
  unset: string[];
  /** Array keys that only grew at the end (the console): just the new items. */
  append: Record<string, readonly unknown[]>;
};

const KEYFRAME_INTERVAL = 64;
const CACHE_SIZE = 256;
const FORMAT = 1;

const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether `next` is `previous` with items added at the end, judged by reference so the check stays cheap. */
function extendsByReference(previous: readonly unknown[], next: readonly unknown[]): boolean {
  if (next.length <= previous.length) return false;
  for (let i = 0; i < previous.length; i++) if (!Object.is(previous[i], next[i])) return false;
  return true;
}

function diffKey(path: string, before: unknown, after: unknown, patch: Patch, mayNest: boolean): void {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after) && extendsByReference(before, after)) {
    patch.append[path] = after.slice(before.length);
    return;
  }
  if (mayNest && isPlain(before) && isPlain(after)) {
    diffObject(path, before, after, patch, false);
    return;
  }
  patch.set[path] = after;
}

function diffObject(prefix: string, before: Plain, after: Plain, patch: Patch, mayNest: boolean): void {
  const join = (key: string) => (prefix === "" ? key : `${prefix}.${key}`);
  for (const key of Object.keys(before)) if (!(key in after)) patch.unset.push(join(key));
  for (const key of Object.keys(after)) {
    if (key in before) diffKey(join(key), before[key], after[key], patch, mayNest);
    else patch.set[join(key)] = after[key];
  }
}

function diff(index: number, previous: Tick, next: Tick): Patch {
  const patch: Patch = { index, set: {}, unset: [], append: {} };
  diffObject("", previous as unknown as Plain, next as unknown as Plain, patch, true);
  return patch;
}

/** Applies a patch without touching `previous`; every part the patch leaves alone is shared with it. */
function apply(previous: Tick, patch: Patch): Tick {
  const next: Plain = { ...(previous as unknown as Plain) };
  const copied = new Set<string>();
  const container = (path: string): [Plain, string] => {
    const dot = path.indexOf(".");
    if (dot < 0) return [next, path];
    const top = path.slice(0, dot);
    if (!copied.has(top)) {
      next[top] = { ...(next[top] as Plain) };
      copied.add(top);
    }
    return [next[top] as Plain, path.slice(dot + 1)];
  };
  for (const path of patch.unset) {
    const [holder, key] = container(path);
    delete holder[key];
  }
  for (const [path, value] of Object.entries(patch.set)) {
    const [holder, key] = container(path);
    holder[key] = value;
  }
  for (const [path, items] of Object.entries(patch.append)) {
    const [holder, key] = container(path);
    holder[key] = [...(holder[key] as readonly unknown[]), ...items];
  }
  return next as unknown as Tick;
}

// JSON cannot carry NaN, Infinity, -0 or a bigint: they travel as one-key tagged objects.
function encode(this: unknown, _key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { $big: (value < 0n ? "-0x" : "0x") + (value < 0n ? -value : value).toString(16) };
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) return { $num: Object.is(value, -0) ? "-0" : String(value) };
  return value;
}

function decode(_key: string, value: unknown): unknown {
  if (!isPlain(value)) return value;
  const keys = Object.keys(value);
  if (keys.length !== 1) return value;
  const tagged = value["$big"] ?? value["$num"];
  if (typeof tagged !== "string") return value;
  if (keys[0] === "$num") {
    if (tagged === "-0") return -0;
    if (tagged === "NaN") return NaN;
    if (tagged === "Infinity") return Infinity;
    if (tagged === "-Infinity") return -Infinity;
    return value;
  }
  if (keys[0] === "$big") return tagged.startsWith("-") ? -BigInt(tagged.slice(1)) : BigInt(tagged);
  return value;
}

type Serialized = { format: number; keyframeInterval: number; length: number; first: Tick | null; patches: Patch[] };

function malformed(why: string): never {
  throw new Error(`not a serialized timeline: ${why}`);
}

function checkShape(data: unknown): Serialized {
  if (!isPlain(data) || data["format"] !== FORMAT) return malformed("unknown format");
  const { keyframeInterval, length, first, patches } = data;
  if (typeof keyframeInterval !== "number" || !Number.isInteger(keyframeInterval) || keyframeInterval < 1) return malformed("bad keyframe interval");
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) return malformed("bad length");
  if (!Array.isArray(patches) || patches.length !== Math.max(length - 1, 0)) return malformed("patch count does not match the length");
  if (length === 0 ? first !== null : !isPlain(first)) return malformed("first tick");
  patches.forEach((p: unknown, i) => {
    if (!isPlain(p) || p["index"] !== i + 1 || !isPlain(p["set"]) || !Array.isArray(p["unset"]) || !isPlain(p["append"])) malformed(`patch ${i + 1}`);
  });
  return data as Serialized;
}

export class TimelineStore {
  readonly #interval: number;
  /** Tick k * interval, in full. */
  readonly #keyframes: readonly Tick[];
  /** `#patches[i]` turns tick i - 1 into tick i; there is none for tick 0. */
  readonly #patches: readonly (Patch | null)[];
  readonly #cache = new Map<number, Tick>();

  private constructor(interval: number, keyframes: readonly Tick[], patches: readonly (Patch | null)[]) {
    this.#interval = interval;
    this.#keyframes = keyframes;
    this.#patches = patches;
  }

  static fromTicks(ticks: readonly Tick[]): TimelineStore {
    const keyframes: Tick[] = [];
    const patches: (Patch | null)[] = [];
    ticks.forEach((tick, i) => {
      if (i % KEYFRAME_INTERVAL === 0) keyframes.push(tick);
      const previous = ticks[i - 1];
      patches.push(previous === undefined ? null : diff(i, previous, tick));
    });
    return new TimelineStore(KEYFRAME_INTERVAL, keyframes, patches);
  }

  static deserialize(json: string): TimelineStore {
    const data = checkShape(JSON.parse(json, decode));
    const keyframes: Tick[] = [];
    const patches: (Patch | null)[] = [];
    let tick = data.first;
    if (tick) {
      keyframes.push(tick);
      patches.push(null);
    }
    data.patches.forEach((patch, k) => {
      const index = k + 1;
      if (!tick) return;
      tick = apply(tick, patch);
      patches.push(patch);
      if (index % data.keyframeInterval === 0) keyframes.push(tick);
    });
    return new TimelineStore(data.keyframeInterval, keyframes, patches);
  }

  get length(): number {
    return this.#patches.length;
  }

  get keyframeInterval(): number {
    return this.#interval;
  }

  /** How many materialized ticks the LRU holds right now (never more than 256). */
  get cachedCount(): number {
    return this.#cache.size;
  }

  at(index: number): Tick {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new RangeError(`tick ${index} is outside the timeline of ${this.length} ticks`);
    const hit = this.#cache.get(index);
    if (hit) {
      this.#remember(index, hit);
      return hit;
    }
    let start = index;
    while (start > 0 && !this.#cache.has(start) && start % this.#interval !== 0) start -= 1;
    let tick = this.#cache.get(start) ?? this.#keyframes[start / this.#interval];
    if (!tick) throw new Error(`the timeline has no keyframe for tick ${start}`);
    for (let i = start + 1; i <= index; i++) {
      const patch = this.#patches[i];
      if (!patch) throw new Error(`the timeline has no patch for tick ${i}`);
      tick = apply(tick, patch);
      this.#remember(i, tick);
    }
    return tick;
  }

  serialize(): string {
    const data: Serialized = {
      format: FORMAT,
      keyframeInterval: this.#interval,
      length: this.length,
      first: this.#keyframes[0] ?? null,
      patches: this.#patches.flatMap((p) => (p ? [p] : [])),
    };
    return JSON.stringify(data, encode);
  }

  #remember(index: number, tick: Tick): void {
    this.#cache.delete(index);
    this.#cache.set(index, tick);
    if (this.#cache.size > CACHE_SIZE) {
      const oldest = this.#cache.keys().next();
      if (!oldest.done) this.#cache.delete(oldest.value);
    }
  }
}
