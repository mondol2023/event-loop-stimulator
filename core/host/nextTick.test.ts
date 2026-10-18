import { describe, expect, it } from "vitest";
import { simulate } from "@/core/timeline/simulate";

// process.nextTick and processTicksAndRejections (lib/internal/process/task_queues.js).

const run = (source: string) => simulate(source, "js");

describe("process.nextTick", () => {
  it("drains the whole tick queue before the microtask queue, then repeats while ticks remain", () => {
    const r = run(`Promise.resolve().then(() => { console.log("p1"); process.nextTick(() => console.log("t3")); }).then(() => console.log("p2"));
process.nextTick(() => { console.log("t1"); process.nextTick(() => console.log("t2")); });`);
    expect(r.stdout).toBe("t1\nt2\np1\np2\nt3\n");
  });

  it("passes extra arguments and calls with an undefined receiver", () => {
    expect(run(`process.nextTick(function (a, b) { "use strict"; console.log(a, b, this); }, 1, "x");`).stdout).toBe("1 x undefined\n");
  });

  it("a callback that is not a function stops the run", () => {
    expect(run(`process.nextTick(5);`).stop).toMatchObject({ kind: "unsupported" });
  });

  it("an uncaught error in a tick skips every remaining tick, microtask and timer", () => {
    const r = run(`process.nextTick(() => { throw new Error("x"); }); process.nextTick(() => console.log("never"));
Promise.resolve().then(() => console.log("never")); setTimeout(() => console.log("never"), 0);`);
    expect(r.stdout).toBe("");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("    at process.processTicksAndRejections (node:internal/process/task_queues:85:11)\n");
  });
});
