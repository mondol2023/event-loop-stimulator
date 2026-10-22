import { describe, expect, it } from "vitest";
import { LIMITS, SIMULATION_LIMIT_NOTICE, SimulationHalt } from "./limits";
import { simulate, type SimulationResult } from "./simulate";

// One program per limit (Decision D3, PROMPT.md §7.1): each stops with the "real Node would
// continue" notice in `warnings` and `stop`, never in the streams and never as a JS RangeError.

function expectLimit(r: SimulationResult, limit: string): void {
  expect(r.stop).toEqual({ kind: "limit", limit });
  expect(r.warnings).toContain(SIMULATION_LIMIT_NOTICE);
  expect(r.stderr).not.toMatch(/RangeError|Maximum call stack/);
  expect(r.stdout).not.toContain(SIMULATION_LIMIT_NOTICE);
  // The process never exited: `stop` is what says the run is incomplete.
  expect(r.exitCode).toBe(0);
}

describe("LIMITS", () => {
  it("pins the §7.1 values and the work budget", () => {
    expect(LIMITS).toEqual({
      ticks: 5000,
      callDepth: 64,
      heapObjects: 1024,
      virtualTimeMs: 60000,
      work: 1_000_000,
      outputChars: 1_048_576,
      stringChars: 8_388_608,
    });
  });

  it("carries the stop on SimulationHalt", () => {
    const halt = new SimulationHalt({ kind: "limit", limit: "ticks" });
    expect(halt.stop).toEqual({ kind: "limit", limit: "ticks" });
  });
});

describe("simulation limits", () => {
  // The output and string budgets bound the memory of the host running the model: a worker thread
  // that runs out of heap on a huge string can abort the whole server process, not only itself.
  it("output: printing past outputChars stops before the oversized write", () => {
    const r = simulate("console.log('start'); let s = 'y'; for (let i = 0; i < 21; i++) s = s + s; console.log(s);", "js");
    expectLimit(r, "output");
    expect(r.stdout).toBe("start\n");
  });

  it("output: the budget is stdout and stderr together", () => {
    // Four lines of 2**18 + 1 characters: the fourth would pass 1 Mi in total.
    const src = "let s = 'y'; for (let i = 0; i < 18; i++) s = s + s; console.log(s); console.error(s); console.log(s); console.log(s);";
    const r = simulate(src, "js");
    expectLimit(r, "output");
    expect(r.stdout.length).toBe(2 * (2 ** 18 + 1));
    expect(r.stderr.length).toBe(2 ** 18 + 1);
  });

  it("strings: building strings past stringChars stops, whether or not they are printed", () => {
    expectLimit(simulate("let s = 'y'; for (let i = 0; i < 26; i++) s = s + s; s.length;", "js"), "strings");
    expectLimit(simulate("let a = ['y']; for (let i = 0; i < 26; i++) a = [a.join(''), a.join('')];", "js"), "strings");
    expectLimit(simulate("let s = 'y'; for (let i = 0; i < 26; i++) s = `${s}${s}`;", "js"), "strings");
  });

  it("strings: ordinary string building stays well inside the budget", () => {
    const r = simulate("let s = ''; for (let i = 0; i < 200; i++) s += i; console.log(s.length);", "js");
    expect(r.stop).toBeUndefined();
    expect(r.stdout).toBe("490\n");
  });

  it("ticks: an infinite loop stops instead of hanging", () => {
    expectLimit(simulate("console.log('start'); while (true) {}", "js"), "ticks");
  });

  it("ticks: keeps the output printed before the stop", () => {
    const r = simulate("console.log('start'); while (true) {}", "js");
    expect(r.stdout).toBe("start\n");
  });

  it("callDepth: unbounded recursion is a limit, not a RangeError", () => {
    const r = simulate("console.log('start'); function f(){ f(); } f();", "js");
    expectLimit(r, "callDepth");
    expect(r.stdout).toBe("start\n");
  });

  it("heapObjects: allocating past 1,024 objects stops", () => {
    // A loop would hit the tick limit first (a dispatch is a tick), so allocate straight-line.
    const r = simulate(`console.log('start'); const a = [${"{},".repeat(1100)}]; console.log('unreachable');`, "js");
    expectLimit(r, "heapObjects");
    expect(r.stdout).toBe("start\n");
  });

  it("virtualTime: an interval prints exactly the 60 lines due at or before 60,000 ms", () => {
    const r = simulate('setInterval(() => console.log("x"), 1000);', "js");
    expectLimit(r, "virtualTime");
    expect(r.stdout).toBe("x\n".repeat(60));
  });

  it("work: a map over a huge holey array stops instead of spinning", () => {
    const r = simulate("console.log('start'); const a = []; a.length = 4294967295; a.map((x) => x);", "js");
    expectLimit(r, "work");
    expect(r.stdout).toBe("start\n");
  });

  it("ticks are statement-level: ~12,000 dispatches in 1,000 iterations (4 ticks each) stay under the limit", () => {
    const r = simulate("let x = 0; for (let i = 0; i < 1000; i = i + 1) { x = x + i * 2 - 1; } console.log(x);", "js");
    expect(r.stop).toBeUndefined();
    expect(r.stdout).toBe("998000\n");
  });

  it("ticks: a tight loop of statements still reaches the limit", () => {
    expectLimit(simulate("let x = 0; for (let i = 0; i < 100000; i = i + 1) { x = x + 1; }", "js"), "ticks");
  });

  it("gives the same stop for the same input", () => {
    const src = "while (true) {}";
    expect(simulate(src, "js", { record: false })).toEqual(simulate(src, "js", { record: false }));
  });
});

describe("unsupported stops", () => {
  it("a %j directive stops as unsupported, with the reason in warnings and none in the streams", () => {
    const r = simulate("console.log('before'); console.log('%j', { a: 1 }); console.log('after');", "js");
    expect(r.stop?.kind).toBe("unsupported");
    expect(r.stdout).toBe("before\n");
    expect(r.stderr).toBe("");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/%j/);
    expect(r.warnings).not.toContain(SIMULATION_LIMIT_NOTICE);
  });
});
