import { describe, expect, it } from "vitest";
import { compileBaseline } from "@/core/baseline/BaselineCompiler";
import { machineStateAt } from "@/core/baseline/machineState";
import type { BaselineCode } from "@/core/baseline/Template";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { simulate } from "@/core/timeline/simulate";
import { traceHardware } from "./traceHardware";

function run(source: string) {
  const { program } = new CompilationManager().compile(source, "js");
  if (!program) throw new Error("no program");
  const baselines: BaselineCode[] = program.functions.map((fn) => {
    const compiled = compileBaseline(fn);
    return compiled.ok ? compiled.value : { instructions: [] };
  });
  return { ticks: simulate(source, "js").ticks, baselines };
}

// core/ cannot read files, so this is the program of tests/conformance/fixtures/nexttick-vs-promise.cjs; the worker test runs the file itself.
const SOURCE = `
console.log("sync 1");
Promise.resolve()
  .then(() => {
    console.log("promise 1");
    process.nextTick(() => console.log("tick scheduled from a promise job"));
  })
  .then(() => console.log("promise 2"));
process.nextTick(() => {
  console.log("tick 1");
  Promise.resolve().then(() => console.log("promise scheduled from a tick"));
  process.nextTick(() => console.log("tick scheduled from a tick"));
});
process.nextTick(() => console.log("tick 2"));
Promise.resolve().then(() => console.log("promise 3"));
console.log("sync 2");
`;
const fixture = run(SOURCE);

describe("traceHardware", () => {
  it("returns one step per tick, and nothing for no ticks", () => {
    expect(traceHardware([], [])).toEqual([]);
    const steps = traceHardware(fixture.ticks, fixture.baselines);
    expect(steps).toHaveLength(fixture.ticks.length);
    expect(steps.length).toBeGreaterThan(0);
  });

  it("is deterministic: two runs are deep-equal", () => {
    const again = run(SOURCE);
    expect(traceHardware(again.ticks, again.baselines)).toEqual(traceHardware(fixture.ticks, fixture.baselines));
  });

  it("gives a tick inside baseline code a bus access that a cache level serves, and others nothing", () => {
    const steps = traceHardware(fixture.ticks, fixture.baselines);
    let withBus = 0;
    fixture.ticks.forEach((tick, i) => {
      const baseline = tick.pos ? fixture.baselines[tick.pos.functionId] : undefined;
      const machine = baseline ? machineStateAt(tick, baseline) : null;
      const step = steps[i];
      if (!machine) {
        expect(step).toMatchObject({ alu: null, bus: null, servedBy: null });
        return;
      }
      if (step?.bus) {
        withBus++;
        expect(step.servedBy).not.toBeNull();
      } else expect(step?.servedBy).toBeNull();
    });
    expect(withBus).toBeGreaterThan(0);
  });

  it("keeps the caches within their sizes, L1 inside L2, and carries them over a tick with no baseline code", () => {
    const steps = traceHardware(fixture.ticks, fixture.baselines);
    let carried = 0;
    steps.forEach((step, i) => {
      expect(step.l1.length).toBeLessThanOrEqual(8);
      expect(step.l2.length).toBeLessThanOrEqual(32);
      for (const tag of step.l1) expect(step.l2).toContain(tag);
      const prev = steps[i - 1];
      if (prev && step.bus === null) {
        expect(step.l1).toEqual(prev.l1);
        expect(step.l2).toEqual(prev.l2);
        carried++;
      }
    });
    expect(carried).toBeGreaterThan(0);
  });

  it("misses to RAM on a new line and hits in L1 when the same line is touched again", () => {
    const served = traceHardware(fixture.ticks, fixture.baselines).map((s) => s.servedBy);
    expect(served).toContain("ram");
    expect(served).toContain("l1");
  });
});
