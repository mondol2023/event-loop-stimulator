import { describe, expect, it } from "vitest";
import { simulate } from "@/core/timeline/simulate";
import { TIMER_ARMED_AFTER_WRITE } from "./nondeterminism";

// The loop as a whole: phase order, exit, and the Node-internal frames below each kind of
// callback. Every tail here was probed on the pinned node (docs/TARGET.md).

const run = (source: string) => simulate(source, "js");

/** Logs the stack of an Error built inside the callback that calls it. */
const S = 'const s = () => console.log(new Error("x").stack);\n';

/** The Node-internal frames of each logged stack, joined by `|` (user frames dropped). */
const tails = (stdout: string): string[] =>
  stdout
    .split("Error: x\n")
    .slice(1)
    .map((block) =>
      block
        .split("\n")
        .filter((l) => l.startsWith("    at ") && !l.includes("main.cjs"))
        .map((l) => l.slice(7))
        .join("|"),
    );

/** The user frames (`at … (main.cjs:L:C)`) in the logged output. */
const userFrames = (stdout: string): string[] => stdout.split("\n").filter((l) => l.includes("main.cjs"));

const MAIN_TAIL =
  "    at Module._compile (node:internal/modules/cjs/loader:1872:14)\n" +
  "    at Object..js (node:internal/modules/cjs/loader:2003:10)\n" +
  "    at Module.load (node:internal/modules/cjs/loader:1594:32)\n" +
  "    at Module._load (node:internal/modules/cjs/loader:1396:12)\n" +
  "    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)\n" +
  "    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)\n" +
  "    at node:internal/main/run_main_module:33:47\n";

describe("NodeEventLoop phases", () => {
  it("runs timers, then immediates of the same iteration, until nothing is ref'd", () => {
    const r = run(`setTimeout(() => { console.log("t1"); setImmediate(() => console.log("i")); setTimeout(() => console.log("t2"), 0); }, 3);`);
    expect(r).toMatchObject({ stdout: "t1\ni\nt2\n", exitCode: 0, warnings: [] });
  });

  it("drains ticks and microtasks after every timer and immediate callback", () => {
    const r = run(`setTimeout(() => { console.log("a"); Promise.resolve().then(() => console.log("a.p")); }, 1);
setTimeout(() => console.log("b"), 1);`);
    expect(r.stdout).toBe("a\na.p\nb\n");
  });

  it("flags a timer armed after output that followed another timer's arming, even after an earlier write", () => {
    // Real node, probed under load: "a b t1 t2" 52 times, "a b t2 t1" 12 times (the "b" write can
    // delay t1's start by a ms). Reduced from the program that broke the seed-11 differential run.
    const r = run(`console.log("a");
setTimeout(() => console.log("t2"), 2);
console.log("b");
setTimeout(() => console.log("t1"), 1);`);
    expect(r.stdout).toBe("a\nb\nt1\nt2\n");
    expect(r.warnings).toEqual([TIMER_ARMED_AFTER_WRITE.warning]);
  });

  it("exits 0 with no output for an empty loop", () => {
    expect(run("")).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("an uncaught error in a timer prints the timer tail and skips everything after it", () => {
    const r = run(`setTimeout(() => { throw new Error("t"); }, 1);\nsetTimeout(() => console.log("never"), 1);`);
    expect(r.stdout).toBe("");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("    at Timeout._onTimeout (main.cjs:1:26)\n    at listOnTimeout (node:internal/timers:635:17)\n");
  });
});

describe("Node-internal frames below a drain", () => {
  it("a microtask after the main script has no Node frames unless a tick was scheduled", () => {
    // Writing to stdout schedules the stream's afterWrite tick, so the drain goes through processTicksAndRejections.
    expect(tails(run(`${S}Promise.resolve().then(s);`).stdout)).toEqual([""]);
    expect(tails(run(`${S}console.log("x"); Promise.resolve().then(s);`).stdout)).toEqual([
      "process.processTicksAndRejections (node:internal/process/task_queues:104:5)",
    ]);
  });

  it("a pending rejection also routes the drain through processTicksAndRejections", () => {
    expect(tails(run(`${S}Promise.reject(1).catch(() => {}); Promise.resolve().then(s);`).stdout)).toEqual([
      "process.processTicksAndRejections (node:internal/process/task_queues:104:5)",
    ]);
  });

  it("between two timers of one pass the drain is runNextTicks inside listOnTimeout", () => {
    const r = run(`${S}setTimeout(() => { Promise.resolve().then(s); }, 1);
setTimeout(() => { process.nextTick(s); }, 1);
setTimeout(() => {}, 1);`);
    expect(tails(r.stdout)).toEqual([
      "runNextTicks (node:internal/process/task_queues:65:5)|listOnTimeout (node:internal/timers:597:9)|process.processTimers (node:internal/timers:571:7)",
      "processTicksAndRejections (node:internal/process/task_queues:85:11)|runNextTicks (node:internal/process/task_queues:69:3)|" +
        "listOnTimeout (node:internal/timers:597:9)|process.processTimers (node:internal/timers:571:7)",
    ]);
  });

  it("between two timer lists the drain is runNextTicks inside processTimers", () => {
    // The 1 ms list is re-armed to expire at 2 ms, together with the 2 ms list, which runs first (lower id).
    const r = run(`${S}setTimeout(() => { setTimeout(() => {}, 1); }, 1);
setTimeout(() => { Promise.resolve().then(s); }, 2);`);
    expect(tails(r.stdout)).toEqual(["runNextTicks (node:internal/process/task_queues:65:5)|process.processTimers (node:internal/timers:568:9)"]);
  });

  it("between two immediates the drain is runNextTicks inside processImmediate", () => {
    const r = run(`${S}setImmediate(() => { console.log(1); Promise.resolve().then(s); }); setImmediate(() => {});`);
    expect(tails(r.stdout)).toEqual([
      "processTicksAndRejections (node:internal/process/task_queues:104:5)|runNextTicks (node:internal/process/task_queues:69:3)|" +
        "process.processImmediate (node:internal/timers:502:9)",
    ]);
  });

  it("after the last callback of a pass the drain is the callback scope's", () => {
    const r = run(`${S}setTimeout(() => { Promise.resolve().then(() => { process.nextTick(s); s(); }); }, 1);`);
    expect(tails(r.stdout)).toEqual(["", "process.processTicksAndRejections (node:internal/process/task_queues:85:11)"]);
  });
});

describe("stack frames of timer and immediate callbacks (V8 formats `stack` lazily)", () => {
  it("names the Timeout and Immediate receivers and the property the callback is called through", () => {
    const r = run(`function named() { console.log(new Error().stack); }
setTimeout(named, 1); setImmediate(named); setImmediate(() => console.log(new Error().stack));`);
    expect(userFrames(r.stdout)).toEqual([
      "    at Immediate.named [as _onImmediate] (main.cjs:1:32)",
      "    at Immediate._onImmediate (main.cjs:2:75)",
      "    at Timeout.named [as _onTimeout] (main.cjs:1:32)",
    ]);
  });

  it("an immediate's stack read after the callback returned no longer finds _onImmediate", () => {
    const r = run(`let saved; setImmediate(() => { saved = new Error(); }); setTimeout(() => console.log(saved.stack), 5);`);
    expect(userFrames(r.stdout)).toEqual(["    at Immediate.<anonymous> (main.cjs:1:41)"]);
  });

  it("the header is formatted at first access too", () => {
    const r = run(`const e = new Error("a"); e.message = "b"; console.log(e.stack);`);
    expect(r.stdout).toBe(`Error: b\n    at Object.<anonymous> (main.cjs:1:11)\n${MAIN_TAIL}`);
  });
});
