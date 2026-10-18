import { describe, expect, it } from "vitest";
import { simulate } from "@/core/timeline/simulate";

// Unhandled-rejection processing in the default `throw` mode (lib/internal/process/promises.js).

const run = (source: string) => simulate(source, "js");

describe("unhandled rejections", () => {
  it("are checked only after the tick and microtask queues drain", () => {
    const r = run(`const p = Promise.reject(1); Promise.resolve().then(() => {}).then(() => p.catch((v) => console.log("caught", v)));`);
    expect(r).toMatchObject({ stdout: "caught 1\n", stderr: "", exitCode: 0 });
  });

  it("the first one still unhandled, in rejection order, is fatal and nothing else runs", () => {
    const r = run(`Promise.reject(1); Promise.reject(2); setTimeout(() => console.log("never"), 0);`);
    expect(r.stdout).toBe("");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('The promise rejected with the reason "1".');
    expect(r.stderr).not.toContain('reason "2"');
  });

  it("a rejection that was handled and unhandled again is skipped (handled before the check)", () => {
    const r = run(`const a = Promise.reject(1); a.catch(() => {}); Promise.reject(2);`);
    expect(r.stderr).toContain('reason "2"');
  });

  it("a rejection inside a timer callback is checked in the drain after that callback", () => {
    const r = run(`setTimeout(() => { Promise.reject(3); }, 1); setTimeout(() => console.log("never"), 1);`);
    expect(r.stdout).toBe("");
    expect(r.exitCode).toBe(1);
    // Between two timers of one pass the drain is runNextTicks inside listOnTimeout (probed on node).
    expect(r.stderr).toContain(
      "    at processTicksAndRejections (node:internal/process/task_queues:106:37)\n" +
        "    at runNextTicks (node:internal/process/task_queues:69:3)\n" +
        "    at listOnTimeout (node:internal/timers:597:9)\n" +
        "    at process.processTimers (node:internal/timers:571:7) {\n",
    );
  });

  it("after the last callback of a pass the drain is processTicksAndRejections from the callback scope", () => {
    const r = run(`setImmediate(() => { Promise.reject(4); });`);
    expect(r.stderr).toContain("    at process.processTicksAndRejections (node:internal/process/task_queues:106:37) {\n");
  });
});
