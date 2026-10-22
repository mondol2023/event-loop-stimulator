import type { GcEvent } from "@/core/timeline/Command";
import type { HeapObject } from "../objects/HeapObject";
import { estimatedSize } from "./estimatedSize";
import type { Heap } from "./Heap";
import { markCompact } from "./MarkCompact";
import { OldGen } from "./OldGen";
import { reachableFrom } from "./reachability";
import { scavenge } from "./Scavenger";
import { YoungGen } from "./YoungGen";

// The modeled garbage collector (Illustrative, PROMPT.md §3.2). V8 itself is not run, so no
// object is ever freed: the model tracks which generation each object of the program would live
// in and reports the collections a real heap of this size would have done. It only reads the
// object graph, so what a program prints cannot depend on it (the exactness firewall).

export type GcOptions = {
  /** The size of one semi-space of the young generation. */
  readonly youngBytes: number;
  /** The size of the old generation at which a mark-compact runs. */
  readonly oldBytes: number;
};

/** Small on purpose: a program is limited to 1,024 allocations, so a V8-sized (MB) semi-space would never fill. */
export const DEFAULT_GC_OPTIONS: GcOptions = { youngBytes: 16 * 1024, oldBytes: 64 * 1024 };

export type HeapSnapshot = {
  young: { objectCount: number; usedBytes: number; capacityBytes: number };
  old: { objectCount: number; usedBytes: number; capacityBytes: number };
  lastGc?: GcEvent;
};

// Made-up but stable addresses for the two semi-spaces and the old-space pages.
const SEMI_SPACE_A = 0x3b0000000;
const SEMI_SPACE_STRIDE = 0x1000000;
const OLD_SPACE = 0x3c0000000;
const OLD_SPACE_EVACUATION = 0x80000;

const hex = (address: number): string => `0x${address.toString(16)}`;
const milliseconds = (ms: number): number => Math.round(ms * 1000) / 1000;

export class GcModel {
  readonly young: YoungGen;
  readonly old: OldGen;
  readonly #heap: Heap;
  readonly #known = new WeakSet<HeapObject>();
  #seen = 0;
  #scavenges = 0;
  #lastGc: GcEvent | undefined;

  constructor(heap: Heap, options: Partial<GcOptions> = {}) {
    const { youngBytes, oldBytes } = { ...DEFAULT_GC_OPTIONS, ...options };
    this.#heap = heap;
    this.young = new YoungGen(youngBytes);
    this.old = new OldGen(oldBytes);
  }

  generationOf(object: HeapObject): "young" | "old" | "collected" | "untracked" {
    this.#sync();
    if (this.young.has(object)) return "young";
    if (this.old.has(object)) return "old";
    return this.#known.has(object) ? "collected" : "untracked";
  }

  snapshot(): HeapSnapshot {
    this.#sync();
    const snapshot: HeapSnapshot = {
      young: { objectCount: this.young.objectCount, usedBytes: this.young.usedBytes, capacityBytes: this.young.capacityBytes },
      old: { objectCount: this.old.objectCount, usedBytes: this.old.usedBytes, capacityBytes: this.old.limitBytes },
    };
    if (this.#lastGc) snapshot.lastGc = this.#lastGc;
    return snapshot;
  }

  /**
   * Takes in the objects allocated since the last call and, if the young generation is now over
   * its size, collects: a scavenge, then a mark-compact if the old generation is over its limit.
   * `roots` is only called when a collection is due.
   */
  collect(roots: () => Iterable<unknown>): GcEvent[] {
    this.#sync();
    if (this.young.usedBytes <= this.young.capacityBytes) return [];
    const reachable = reachableFrom(roots());
    const events: GcEvent[] = [this.#scavenge(reachable)];
    if (this.old.usedBytes > this.old.limitBytes) events.push(this.#markCompact(reachable));
    this.#lastGc = events.at(-1);
    return events;
  }

  #sync(): void {
    const objects = this.#heap.objects();
    for (; this.#seen < objects.length; this.#seen++) {
      const object = objects[this.#seen];
      if (!object) continue;
      this.#known.add(object);
      this.young.add(object, estimatedSize(object));
    }
  }

  #scavenge(reachable: ReadonlySet<unknown>): GcEvent {
    const from = SEMI_SPACE_A + (this.#scavenges % 2) * SEMI_SPACE_STRIDE;
    const to = SEMI_SPACE_A + ((this.#scavenges + 1) % 2) * SEMI_SPACE_STRIDE;
    this.#scavenges += 1;
    const r = scavenge(this.young, this.old, reachable);
    return {
      type: "scavenge",
      freedObjects: r.freedObjects,
      freedBytes: r.freedBytes,
      survivedObjects: r.survivedObjects,
      promotedObjects: r.promotedObjects,
      fromSpace: hex(from),
      toSpace: hex(to),
      durationMs: milliseconds(0.08 + r.copiedBytes * 0.0000015 + r.promotedObjects * 0.002),
      illustrative: true,
    };
  }

  #markCompact(reachable: ReadonlySet<unknown>): GcEvent {
    const r = markCompact(this.old, reachable);
    return {
      type: "mark-compact",
      freedObjects: r.freedObjects,
      freedBytes: r.freedBytes,
      survivedObjects: r.survivedObjects,
      promotedObjects: 0,
      fromSpace: hex(OLD_SPACE),
      toSpace: hex(OLD_SPACE + OLD_SPACE_EVACUATION),
      durationMs: milliseconds(0.6 + r.liveBytes * 0.000004 + r.survivedObjects * 0.001),
      illustrative: true,
    };
  }
}
