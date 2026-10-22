import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CompileSummary } from "@/server/validation/compile";
import { SandboxPool, type SandboxResult } from "./pool";

const fixture = (name: string) => fileURLToPath(new URL(`../../../tests/fixtures/sandbox/${name}`, import.meta.url));

// The real worker entry is TypeScript that Turbopack bundles for `next start`. Here, plain Node
// runs it through tsx, which also resolves the `@/` paths.
const realWorker = { workerPath: fileURLToPath(new URL("./compile-worker.ts", import.meta.url)), execArgv: ["--import", "tsx"] };
// Loading core/ through tsx takes a while on a cold worker; the timeout here is not what is tested.
const SLOW_START_MS = 30_000;

const pools: SandboxPool[] = [];
const make = (opts: ConstructorParameters<typeof SandboxPool>[0]) => {
  const pool = new SandboxPool(opts);
  pools.push(pool);
  return pool;
};

afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.close()));
});

function summaryOf(result: SandboxResult): CompileSummary {
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error("unreachable");
  return CompileSummary.parse(result.value);
}

describe("SandboxPool with the real compile worker", () => {
  it("runs the core pipeline and returns the D8 summary", async () => {
    const pool = make({ ...realWorker, size: 1, timeoutMs: SLOW_START_MS });
    const summary = summaryOf(await pool.run({ code: "console.log(1)", lang: "js" }));
    expect(summary.diagnostics).toEqual([]);
    expect(summary.output).toEqual({ stdout: "1\n", stderr: "", exitCode: 0 });
    expect(summary.stop).toBeUndefined();
    expect(summary.tickCount).toBeGreaterThan(0);
  }, 60_000);

  it("refuses an excluded API with a diagnostic and no output", async () => {
    const pool = make({ ...realWorker, size: 1, timeoutMs: SLOW_START_MS });
    const summary = summaryOf(await pool.run({ code: "Math.random()", lang: "js" }));
    expect(summary.diagnostics[0]?.code).toBe("E_EXCLUDED_API");
    expect(summary.output).toBeUndefined();
    expect(summary.tickCount).toBe(0);
  }, 60_000);

  it("reports a limit stop for a program that would spin forever", async () => {
    const pool = make({ ...realWorker, size: 1, timeoutMs: SLOW_START_MS });
    const summary = summaryOf(await pool.run({ code: "console.log('start'); while (true) {}", lang: "js" }));
    expect(summary.stop).toEqual({ kind: "limit", limit: "ticks" });
    expect(summary.output?.stdout).toBe("start\n");
    // D3: the notice goes to warnings, never to stdout or stderr.
    expect(summary.warnings).toEqual(["Simulation limit reached — real Node would continue"]);
    expect(summary.output?.stderr).toBe("");
  }, 60_000);

  it("stops a program whose output would exhaust the worker's heap, instead of aborting the process", async () => {
    // Without the output and string budgets this ~100-byte program aborted the parent (exit 134).
    const pool = make({ ...realWorker, size: 1, timeoutMs: SLOW_START_MS });
    const code = 'let s="y"; for(let i=0;i<26;i++) s=s+s; console.log(s); console.log(s); console.error(s)';
    const summary = summaryOf(await pool.run({ code, lang: "js" }));
    expect(summary.stop?.kind).toBe("limit");
    expect(summary.output?.stdout).toBe("");
  }, 60_000);

  it("interprets input, never runs it: process.exit leaves the worker alive", async () => {
    const pool = make({ ...realWorker, size: 1, timeoutMs: SLOW_START_MS });
    expect((await pool.run({ code: "process.exit(1)", lang: "js" })).status).toBe("ok");
    expect(summaryOf(await pool.run({ code: "console.log(2)", lang: "ts" })).output?.stdout).toBe("2\n");
  }, 60_000);

  it("answers a malformed message with a value no summary schema accepts, and keeps serving", async () => {
    const pool = make({ ...realWorker, size: 1, timeoutMs: SLOW_START_MS });
    const malformed = await pool.run({ code: 42, lang: "py" });
    expect(malformed.status).toBe("ok");
    if (malformed.status === "ok") expect(CompileSummary.safeParse(malformed.value).success).toBe(false);
    expect(summaryOf(await pool.run({ code: "console.log(3)", lang: "js" })).output?.stdout).toBe("3\n");
  }, 60_000);

  it("times out a run that outlasts timeoutMs (a 1 ms budget)", async () => {
    const pool = make({ ...realWorker, size: 1, timeoutMs: 1 });
    expect(await pool.run({ code: "while (true) {}", lang: "js" })).toEqual({ status: "timeout" });
  }, 60_000);

  it("answers 10 concurrent runs on 2 workers, each with its own result", async () => {
    const pool = make({ ...realWorker, size: 2, timeoutMs: SLOW_START_MS });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => pool.run({ code: `console.log(${i})`, lang: "js" })),
    );
    results.forEach((result, i) => expect(summaryOf(result).output?.stdout).toBe(`${i}\n`));
  }, 60_000);
});

describe("SandboxPool", () => {
  it("times out a worker that never answers, then serves the next job from a replacement", async () => {
    const looping = make({ workerPath: fixture("loop-forever.mjs"), size: 1, timeoutMs: 200 });
    const started = Date.now();
    expect(await looping.run({})).toEqual({ status: "timeout" });
    expect(Date.now() - started).toBeLessThan(2000);
    // The replacement is a fresh worker of the same kind: it times out again instead of hanging.
    expect(await looping.run({})).toEqual({ status: "timeout" });
  });

  it("reports out_of_memory for an allocation bomb and stays usable", async () => {
    const pool = make({ workerPath: fixture("alloc-bomb.mjs"), size: 1, timeoutMs: 10_000, maxOldGenerationSizeMb: 16 });
    expect(await pool.run({})).toEqual({ status: "crashed", reason: "out_of_memory" });
    expect(await pool.run({})).toEqual({ status: "crashed", reason: "out_of_memory" });
  }, 30_000);

  it("resolves busy once maxQueue jobs are already waiting", async () => {
    const pool = make({ workerPath: fixture("loop-forever.mjs"), size: 1, maxQueue: 1, timeoutMs: 5000 });
    const running = pool.run({});
    const queued = pool.run({});
    expect(await pool.run({})).toEqual({ status: "busy" });
    await pool.close();
    // Nothing is left pending after close.
    expect((await running).status).toBe("crashed");
    expect((await queued).status).toBe("crashed");
  });

  it("close() terminates every worker and rejects further work as crashed", async () => {
    const pool = make({ workerPath: fixture("loop-forever.mjs"), size: 2 });
    await pool.close();
    expect(await pool.run({ code: "a", lang: "js" })).toEqual({ status: "crashed", reason: "error" });
  });

  it("does not throw when a worker cannot be created, and answers crashed", async () => {
    // new Worker(123) throws synchronously (ERR_INVALID_ARG_TYPE): that must neither escape the constructor nor a timer.
    const pool = make({ workerPath: 123 as unknown as string, size: 2 });
    expect(await pool.run({})).toEqual({ status: "crashed", reason: "error" });
    expect(await pool.run({})).toEqual({ status: "crashed", reason: "error" });
  });

  it("does not throw when a spawn function throws, and answers crashed", async () => {
    const pool = make({
      spawn: () => {
        throw new Error("no threads");
      },
      size: 1,
    });
    expect(await pool.run({})).toEqual({ status: "crashed", reason: "error" });
  });

  it("does not respawn a broken worker in a loop: a missing worker file costs one crash per job", async () => {
    const pool = make({ workerPath: fixture("does-not-exist.mjs"), size: 1, timeoutMs: 1000 });
    for (let i = 0; i < 3; i += 1) expect((await pool.run({})).status).toBe("crashed");
    // Give a runaway respawn loop time to show itself, then confirm the pool is still responsive.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await pool.run({})).status).toBe("crashed");
  });
});
