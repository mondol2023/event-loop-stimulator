import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/env", () => ({ getEnv: () => ({}) }));
vi.mock("@/server/repositories/settingRepository", () => ({
  settingRepository: { get: async () => null },
}));

import { DEFAULT_LIMITS, createLimitsProvider } from "./limits";
import { MemoryRateLimitStore } from "./memoryStore";
import { createRateLimiter } from "./rateLimiter";

describe("createRateLimiter", () => {
  it("allows exactly 20 compile.anon calls then denies", async () => {
    const now = () => 5_000_000;
    const limiter = createRateLimiter({
      store: new MemoryRateLimitStore(),
      limits: createLimitsProvider({ load: async () => null, now }),
      now,
    });
    for (let i = 0; i < DEFAULT_LIMITS["compile.anon"].limit; i++) {
      expect((await limiter.check("compile.anon", "k")).allowed).toBe(true);
    }
    const denied = await limiter.check("compile.anon", "k");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("scopes keys by scope", async () => {
    const now = () => 1;
    const limiter = createRateLimiter({
      store: new MemoryRateLimitStore(),
      limits: createLimitsProvider({ load: async () => ({ auth: { limit: 1, windowSec: 60 } }), now }),
      now,
    });
    expect((await limiter.check("auth", "k")).allowed).toBe(true);
    expect((await limiter.check("auth", "k")).allowed).toBe(false);
    expect((await limiter.check("snippet.write", "k")).allowed).toBe(true);
  });
});
