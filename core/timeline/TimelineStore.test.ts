import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { simulate } from "./simulate";
import type { ConsoleLine, Tick } from "./Tick";
import { TimelineStore } from "./TimelineStore";

const BUDGET_BYTES = 20 * 1024 * 1024;

const PROGRAM = `
const kept = [];
for (let i = 0; i < 4000; i++) {
  kept.push({ a: i, b: [i] });
  console.log("line " + i);
}
`;

const realTicks = (() => {
  let cached: readonly Tick[] | undefined;
  return () => (cached ??= simulate(PROGRAM, "js").ticks);
})();

/** A run shaped like the worst case the budget allows: 5,000 ticks, console output that grows every tick, 64 live objects and 3 live timers. */
function syntheticTicks(count: number): Tick[] {
  const seed = simulate("console.log(1);", "js").ticks[0];
  if (!seed) throw new Error("no seed tick");
  const elementsKinds = Object.fromEntries(Array.from({ length: 64 }, (_, k) => [k + 1, "PACKED_SMI_ELEMENTS"]));
  const timers = Array.from({ length: 3 }, (_, k) => ({ id: k + 1, kind: "timeout", label: `setTimeout(tick${k})`, origin: "setTimeout" }));
  const ticks: Tick[] = [];
  let lines: ConsoleLine[] = [];
  for (let i = 0; i < count; i++) {
    lines = [...lines, { stream: "stdout", text: `output line number ${i}\n`, origin: "console" }];
    ticks.push({
      ...seed,
      index: i,
      console: lines,
      timerQueue: timers,
      callStack: [{ ...seed.callStack[0]!, bytecodeOffset: i % 97 }],
      currentLine: (i % 40) + 1,
      virtualTimeMs: Math.floor(i / 100),
      v8: { ...seed.v8, elementsKinds, heap: { ...seed.v8.heap, young: { objectCount: 64 + (i % 7) } } },
      narration: `Step ${i}: the interpreter runs another statement of the loop and writes console line ${i}.`,
    } as unknown as Tick);
  }
  return ticks;
}

describe("TimelineStore", () => {
  it("rebuilds any tick from the keyframe and the patches", () => {
    const ticks = realTicks();
    expect(ticks.length).toBeGreaterThan(1000);
    const store = TimelineStore.fromTicks(ticks);
    expect(store.length).toBe(ticks.length);
    expect(store.keyframeInterval).toBe(64);
    for (const i of [0, 1, 63, 64, 65, 127, 128, ticks.length - 1]) expect(store.at(i)).toEqual(ticks[i]);
  });

  it("gives every tick back whatever the order it is asked in", () => {
    const ticks = realTicks();
    const store = TimelineStore.fromTicks(ticks);
    for (let i = ticks.length - 1; i >= 0; i -= 7) expect(store.at(i)).toEqual(ticks[i]);
    fc.assert(
      fc.property(fc.array(fc.nat(ticks.length - 1), { minLength: 1, maxLength: 40 }), (indexes) => {
        for (const i of indexes) expect(store.at(i)).toEqual(ticks[i]);
      }),
      { numRuns: 60 },
    );
  });

  it("rejects an index outside the timeline", () => {
    const store = TimelineStore.fromTicks(realTicks());
    expect(() => store.at(-1)).toThrow(RangeError);
    expect(() => store.at(store.length)).toThrow(RangeError);
    expect(() => store.at(1.5)).toThrow(RangeError);
  });

  it("stores an empty timeline", () => {
    const store = TimelineStore.fromTicks([]);
    expect(store.length).toBe(0);
    expect(TimelineStore.deserialize(store.serialize()).length).toBe(0);
  });

  it("round-trips through serialize and deserialize", () => {
    const ticks = realTicks();
    const copy = TimelineStore.deserialize(TimelineStore.fromTicks(ticks).serialize());
    expect(copy.length).toBe(ticks.length);
    for (let i = 0; i < ticks.length; i += 13) expect(copy.at(i)).toEqual(ticks[i]);
    expect(copy.at(ticks.length - 1)).toEqual(ticks.at(-1));
  });

  it("serializes the same timeline to the same text", () => {
    const ticks = realTicks();
    const first = TimelineStore.fromTicks(ticks).serialize();
    expect(TimelineStore.deserialize(first).serialize()).toBe(first);
  });

  it("keeps NaN, Infinity, -0 and bigints, which JSON cannot carry", () => {
    const seed = realTicks()[0]!;
    const value = (v: unknown) => ({ ...seed, callStack: [{ ...seed.callStack[0]!, accumulator: { kind: "heap-number", value: v, text: String(v) } }] }) as unknown as Tick;
    const ticks = [value(NaN), value(-0), value(Infinity), value(-Infinity), value(10n ** 30n), value(-255n)];
    const copy = TimelineStore.deserialize(TimelineStore.fromTicks(ticks).serialize());
    const read = (i: number) => (copy.at(i).callStack[0]?.accumulator as { value: unknown }).value;
    expect(read(0)).toBeNaN();
    expect(Object.is(read(1), -0)).toBe(true);
    expect(read(2)).toBe(Infinity);
    expect(read(3)).toBe(-Infinity);
    expect(read(4)).toBe(10n ** 30n);
    expect(read(5)).toBe(-255n);
  });

  it("writes a bigint as a hex string", () => {
    const seed = realTicks()[0]!;
    const tick = { ...seed, narration: "x", callStack: [{ ...seed.callStack[0]!, accumulator: { kind: "heap-number", value: 255n, text: "255" } }] } as unknown as Tick;
    expect(TimelineStore.fromTicks([tick]).serialize()).toContain('"0xff"');
  });

  it("rejects text that is not a timeline", () => {
    expect(() => TimelineStore.deserialize("{}")).toThrow(/timeline/);
    expect(() => TimelineStore.deserialize("not json")).toThrow();
  });

  it("serializes a 5,000-tick run with growing output, 64 live objects and 3 live timers within 20 MB", () => {
    const ticks = syntheticTicks(5000);
    const text = TimelineStore.fromTicks(ticks).serialize();
    const bytes = new TextEncoder().encode(text).length;
    expect(bytes).toBeLessThanOrEqual(BUDGET_BYTES);
    const copy = TimelineStore.deserialize(text);
    for (const i of [0, 63, 64, 2500, 4999]) expect(copy.at(i)).toEqual(ticks[i]);
  });

  it("keeps a real run that stops at a limit within 20 MB", () => {
    const ticks = simulate("const o = []; for (let i = 0; ; i++) { o.push({ a: i }); console.log(i); }", "js").ticks;
    expect(ticks.length).toBeGreaterThan(4000);
    const bytes = new TextEncoder().encode(TimelineStore.fromTicks(ticks).serialize()).length;
    expect(bytes).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it("never holds more than 256 materialized ticks", () => {
    const ticks = syntheticTicks(2000);
    const store = TimelineStore.fromTicks(ticks);
    for (let i = 0; i < ticks.length; i++) {
      store.at(i);
      expect(store.cachedCount).toBeLessThanOrEqual(256);
    }
    for (let i = ticks.length - 1; i >= 0; i -= 3) store.at(i);
    expect(store.cachedCount).toBeLessThanOrEqual(256);
    expect(store.at(5)).toEqual(ticks[5]);
  });
});
