import { beforeEach, expect, it } from "vitest";
import type { BucketConfig, ConsumeResult, RateLimitStore } from "./store";

const CFG: BucketConfig = { capacity: 3, refillPerSec: 0.5 };

/** Behaviour every RateLimitStore implementation must satisfy. Call inside a describe block. */
export function runStoreContract(makeStore: () => Promise<RateLimitStore> | RateLimitStore): void {
  let store: RateLimitStore;
  let prefix: string;
  let n = 0;
  beforeEach(async () => {
    store = await makeStore();
    prefix = `contract-${Date.now()}-${n++}`;
  });

  it("allows up to capacity then denies with an integer retry-after >= 1", async () => {
    const key = `${prefix}:a`;
    const results: ConsumeResult[] = [];
    for (let i = 0; i < 4; i++) results.push(await store.consume(key, CFG, 1_000_000));
    expect(results.slice(0, 3).map((r) => [r.allowed, r.remaining])).toEqual([
      [true, 2],
      [true, 1],
      [true, 0],
    ]);
    const denied = results[3]!;
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(denied.retryAfterSec)).toBe(true);
  });

  it("refills one token after 1/refillPerSec seconds", async () => {
    const key = `${prefix}:b`;
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) await store.consume(key, CFG, t0);
    expect((await store.consume(key, CFG, t0)).allowed).toBe(false);
    const t1 = t0 + (1 / CFG.refillPerSec) * 1000;
    expect((await store.consume(key, CFG, t1)).allowed).toBe(true);
    expect((await store.consume(key, CFG, t1)).allowed).toBe(false);
  });

  it("keeps keys independent", async () => {
    const a = `${prefix}:c1`;
    const b = `${prefix}:c2`;
    for (let i = 0; i < 3; i++) await store.consume(a, CFG, 3_000_000);
    expect((await store.consume(a, CFG, 3_000_000)).allowed).toBe(false);
    expect((await store.consume(b, CFG, 3_000_000)).allowed).toBe(true);
  });
}
