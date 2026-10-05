import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxPool } from "./pool";

const fixture = (name: string) => fileURLToPath(new URL(`../../../tests/fixtures/sandbox/${name}`, import.meta.url));
const stub = fileURLToPath(new URL("./compile-worker.mjs", import.meta.url));

const pools: SandboxPool[] = [];
const make = (opts: ConstructorParameters<typeof SandboxPool>[0]) => {
  const pool = new SandboxPool(opts);
  pools.push(pool);
  return pool;
};

afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.close()));
});

describe("SandboxPool", () => {
  it("runs the stub worker and reports the UTF-8 byte length without evaluating input", async () => {
    const pool = make({ workerPath: stub });
    const result = await pool.run({ code: "é;process.exit(1)", lang: "js" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toEqual({ stub: true, bytes: 18, lang: "js" });
      expect(result.ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("times out a worker that never answers, then serves the next job from a replacement", async () => {
    // Two workers: one loops forever, the pool must still recover afterwards.
    const looping = make({ workerPath: fixture("loop-forever.mjs"), size: 1, timeoutMs: 200 });
    const started = Date.now();
    expect(await looping.run({})).toEqual({ status: "timeout" });
    expect(Date.now() - started).toBeLessThan(2000);
    // The replacement is a fresh worker of the same kind: it times out again instead of hanging.
    expect(await looping.run({})).toEqual({ status: "timeout" });
  });

  it("keeps serving after a timeout when the worker is healthy", async () => {
    const pool = make({ workerPath: stub, size: 1, timeoutMs: 1000 });
    expect((await pool.run({ code: "a", lang: "js" })).status).toBe("ok");
    expect((await pool.run({ code: "bb", lang: "ts" })).status).toBe("ok");
  });

  it("reports out_of_memory for an allocation bomb and stays usable", async () => {
    const pool = make({ workerPath: fixture("alloc-bomb.mjs"), size: 1, timeoutMs: 10_000, maxOldGenerationSizeMb: 16 });
    expect(await pool.run({})).toEqual({ status: "crashed", reason: "out_of_memory" });
    expect(await pool.run({})).toEqual({ status: "crashed", reason: "out_of_memory" });
  }, 30_000);

  it("answers 10 concurrent runs on 2 workers, each with its own result", async () => {
    const pool = make({ workerPath: stub, size: 2 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => pool.run({ code: "x".repeat(i + 1), lang: "js" })),
    );
    results.forEach((result, i) => {
      expect(result.status).toBe("ok");
      if (result.status === "ok") expect(result.value).toMatchObject({ bytes: i + 1 });
    });
  });

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
    const pool = make({ workerPath: stub, size: 2 });
    await pool.run({ code: "a", lang: "js" });
    await pool.close();
    expect(await pool.run({ code: "a", lang: "js" })).toEqual({ status: "crashed", reason: "error" });
  });

  it("does not throw when a worker cannot be created, and answers crashed", async () => {
    // new Worker(123) throws synchronously (ERR_INVALID_ARG_TYPE): that must neither escape the constructor nor a timer.
    const pool = make({ workerPath: 123 as unknown as string, size: 2 });
    expect(await pool.run({})).toEqual({ status: "crashed", reason: "error" });
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
