import { describe, expect, it } from "vitest";
import { MemoryRateLimitStore } from "./memoryStore";
import { runStoreContract } from "./store.contract";

describe("MemoryRateLimitStore", () => {
  describe("contract", () => {
    runStoreContract(() => new MemoryRateLimitStore());
  });

  it("bounds the number of tracked keys", async () => {
    const store = new MemoryRateLimitStore({ maxKeys: 100 });
    const cfg = { capacity: 1, refillPerSec: 1 };
    for (let i = 0; i < 1000; i++) await store.consume(`k${i}`, cfg, 1000);
    expect(store.size).toBeLessThanOrEqual(100);
  });

  it("evicts the least-recently-updated key, keeping the most recent one", async () => {
    const store = new MemoryRateLimitStore({ maxKeys: 2 });
    const cfg = { capacity: 1, refillPerSec: 0.001 };
    await store.consume("old", cfg, 1000);
    await store.consume("mid", cfg, 1000);
    await store.consume("old", cfg, 1000); // touch: now "mid" is the oldest
    await store.consume("new", cfg, 1000); // evicts "mid"
    expect(store.size).toBe(2);
    expect((await store.consume("old", cfg, 1000)).allowed).toBe(false); // still tracked
    expect((await store.consume("mid", cfg, 1000)).allowed).toBe(true); // evicted, fresh bucket
  });
});
