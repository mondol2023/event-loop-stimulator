import { describe, expect, it } from "vitest";
import { FIRST_ITERATION_TIMER_VS_IMMEDIATE, RE_ARMED_LIST_TIE, TIMER_ARMED_AFTER_WRITE } from "@/core/host/nondeterminism";
import type { TaskRef, Tick } from "@/core/timeline/Tick";
import { ordersAtRisk } from "./warnings";

let next = 1;
const task = (kind: TaskRef["kind"], label = `${kind}-${next}`): TaskRef => ({ id: next++ as TaskRef["id"], kind, label, origin: kind });
const warn = (message: string): Tick["warnings"] => [{ kind: "nondeterminism", message }];
const sorted = (ids: Iterable<number>): number[] => [...ids].sort((a, b) => a - b);

describe("ordersAtRisk", () => {
  it("flags nothing without a warning", () => {
    expect(ordersAtRisk([task("timeout")], [task("immediate")], []).size).toBe(0);
  });

  it("flags a timeout and an immediate while both are pending (timer vs immediate)", () => {
    const t = task("timeout");
    const i = task("immediate");
    expect(sorted(ordersAtRisk([t], [i], warn(FIRST_ITERATION_TIMER_VS_IMMEDIATE.warning)))).toEqual(sorted([t.id, i.id]));
  });

  it("unflags the timer once the immediate has run, and an immediate with no timer", () => {
    expect(ordersAtRisk([task("timeout")], [], warn(FIRST_ITERATION_TIMER_VS_IMMEDIATE.warning)).size).toBe(0);
    expect(ordersAtRisk([], [task("immediate")], warn(FIRST_ITERATION_TIMER_VS_IMMEDIATE.warning)).size).toBe(0);
  });

  it("flags only timers for a timer-vs-timer rule, and only with two pending", () => {
    const a = task("timeout");
    const b = task("interval");
    const i = task("immediate");
    for (const rule of [RE_ARMED_LIST_TIE, TIMER_ARMED_AFTER_WRITE]) {
      expect(sorted(ordersAtRisk([a, b], [i], warn(rule.warning)))).toEqual(sorted([a.id, b.id]));
      expect(ordersAtRisk([a], [i], warn(rule.warning)).size).toBe(0);
    }
  });

  it("flags a chip whose label appears in a message, even alone", () => {
    const t = task("timeout", "setTimeout(slow, 5)");
    expect(sorted(ordersAtRisk([t], [], warn("Order not guaranteed: setTimeout(slow, 5) may run late")))).toEqual([t.id]);
  });

  it("ignores stopped warnings", () => {
    expect(ordersAtRisk([task("timeout")], [task("immediate")], [{ kind: "stopped", message: "limit" }]).size).toBe(0);
  });
});
