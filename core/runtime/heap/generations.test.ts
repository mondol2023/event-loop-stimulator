import { describe, expect, it } from "vitest";
import { DETACHED_HOST } from "@/core/host/NodeEventLoop";
import type { GcEvent } from "@/core/timeline/Command";
import { Context } from "../objects/Context";
import type { JSObject } from "../objects/JSObject";
import { Realm } from "../Realm";
import { GcModel } from "./GcModel";
import { reachableFrom } from "./reachability";

const DATA = { writable: true, enumerable: true, configurable: true } as const;

/** A realm with a model whose young generation holds about ten small objects. */
function setup(options: { youngBytes?: number; oldBytes?: number } = {}) {
  const realm = new Realm(DETACHED_HOST);
  const model = new GcModel(realm.heap, { youngBytes: 400, oldBytes: 100_000, ...options });
  const events: GcEvent[] = [];
  /** Allocates `count` objects nobody keeps, then lets the model collect if the young generation is full. */
  const churn = (roots: readonly unknown[], count = 12): void => {
    for (let i = 0; i < count; i++) realm.newObject();
    events.push(...model.collect(() => roots));
  };
  return { realm, model, events, churn };
}

describe("the modeled generational heap", () => {
  it("promotes an object that survives two scavenges", () => {
    const { realm, model, events, churn } = setup();
    const kept = realm.newObject();
    churn([kept]);
    expect(events.map((e) => e.type)).toEqual(["scavenge"]);
    expect(events[0]?.promotedObjects).toBe(0);
    expect(model.generationOf(kept)).toBe("young");
    churn([kept]);
    expect(events.map((e) => e.type)).toEqual(["scavenge", "scavenge"]);
    expect(events[1]?.promotedObjects).toBe(1);
    expect(model.generationOf(kept)).toBe("old");
  });

  it("reclaims an object nothing reaches", () => {
    const { realm, model, events, churn } = setup();
    const kept = realm.newObject();
    const lost = realm.newObject();
    churn([kept]);
    expect(model.generationOf(lost)).toBe("collected");
    expect(model.generationOf(kept)).toBe("young");
    expect(events[0]?.freedObjects).toBe(13);
    expect(events[0]?.freedBytes).toBeGreaterThan(0);
    expect(model.snapshot().young.objectCount).toBe(1);
  });

  it("does nothing while the young generation has room", () => {
    const { realm, model, events, churn } = setup({ youngBytes: 100_000 });
    churn([realm.newObject()], 5);
    expect(events).toEqual([]);
    expect(model.snapshot().young.objectCount).toBe(6);
  });

  it("runs a mark-compact when the old generation outgrows its limit, freeing what died there", () => {
    const { realm, model, events, churn } = setup({ oldBytes: 40 });
    const kept = realm.newObject();
    const doomed = realm.newObject();
    churn([kept, doomed]);
    churn([kept, doomed]);
    expect(model.generationOf(doomed)).toBe("old");
    // Both were alive when the old generation first went over its limit, so that compact freed nothing.
    expect(events.filter((e) => e.type === "mark-compact").map((e) => e.freedObjects)).toEqual([0]);
    // `doomed` dies; more survivors fill the old generation again (the limit grew to twice the live data).
    const more = Array.from({ length: 8 }, () => realm.newObject());
    events.length = 0;
    churn([kept, ...more]);
    churn([kept, ...more]);
    const compact = events.find((e) => e.type === "mark-compact");
    expect(compact?.freedObjects).toBe(1);
    expect(model.generationOf(doomed)).toBe("collected");
    expect(model.generationOf(kept)).toBe("old");
  });

  it("promotes survivors that do not fit in the young generation, oldest first", () => {
    const { realm, model, events, churn } = setup({ youngBytes: 200 });
    const kept = Array.from({ length: 12 }, () => realm.newObject());
    churn(kept, 0);
    expect(events[0]?.promotedObjects).toBeGreaterThan(0);
    expect(model.generationOf(kept[0] as JSObject)).toBe("old");
    expect(model.snapshot().young.usedBytes).toBeLessThanOrEqual(200);
  });

  it("marks illustrative addresses and timings on every event", () => {
    const { realm, events, churn } = setup();
    churn([realm.newObject()]);
    const event = events[0];
    expect(event?.illustrative).toBe(true);
    expect(event?.fromSpace).toMatch(/^0x[0-9a-f]+$/);
    expect(event?.toSpace).toMatch(/^0x[0-9a-f]+$/);
    expect(event?.fromSpace).not.toBe(event?.toSpace);
    expect(event?.durationMs).toBeGreaterThan(0);
  });

  it("gives the same events for the same allocations", () => {
    const run = () => {
      const { realm, events, churn } = setup();
      const kept = realm.newObject();
      for (let i = 0; i < 6; i++) churn([kept]);
      return events;
    };
    expect(run()).toEqual(run());
  });
});

describe("reachability from the roots", () => {
  it("follows properties, elements, prototypes, closures' contexts, captures and promise reactions", () => {
    const realm = new Realm(DETACHED_HOST);
    const root = realm.newObject();
    const viaProperty = realm.newObject();
    root.putNamed(realm.maps, "p", viaProperty, DATA);
    const array = realm.newArray([realm.newObject()]);
    root.putNamed(realm.maps, "list", array, DATA);
    const viaContext = realm.newObject();
    const context = new Context(null, 1);
    context.slots[0] = viaContext;
    const viaCapture = realm.newObject();
    const fn = realm.runtimeFunction("f", 0, () => ({ kind: "normal", value: undefined }) as never, [viaCapture]);
    root.putNamed(realm.maps, "f", fn, DATA);
    const derived = realm.newPromise();
    const handler = realm.runtimeFunction("h", 0, () => ({ kind: "normal", value: undefined }) as never);
    const promise = realm.newPromise();
    promise.fulfillReactions.push({ capability: { promise: derived, resolve: undefined, reject: undefined }, type: "fulfill", handler });
    root.putNamed(realm.maps, "promise", promise, DATA);
    const stray = realm.newObject();

    const reached = reachableFrom([root, context]);
    for (const object of [root, viaProperty, array, viaContext, fn, viaCapture, promise, derived, handler]) expect(reached.has(object)).toBe(true);
    expect(reached.has(array.elements.dense[0] as JSObject)).toBe(true);
    expect(reached.has(stray)).toBe(false);
  });

  it("survives cycles", () => {
    const realm = new Realm(DETACHED_HOST);
    const a = realm.newObject();
    const b = realm.newObject();
    a.putNamed(realm.maps, "b", b, DATA);
    b.putNamed(realm.maps, "a", a, DATA);
    const reached = reachableFrom([a]);
    expect(reached.has(a) && reached.has(b)).toBe(true);
  });
});
