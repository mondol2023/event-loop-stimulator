import "server-only";
import { getEnv } from "@/server/env";
import { settingRepository } from "@/server/repositories/settingRepository";
import { createLimitsProvider, type LimitsProvider, type RateLimitScope } from "./limits";
import { MemoryRateLimitStore } from "./memoryStore";
import { getRedisClient } from "./redisClient";
import { RedisRateLimitStore } from "./redisStore";
import type { ConsumeResult, RateLimitStore } from "./store";

export function createRateLimiter(deps: { store: RateLimitStore; limits: LimitsProvider; now: () => number }) {
  return {
    async check(scope: RateLimitScope, key: string): Promise<ConsumeResult> {
      const limits = await deps.limits.get();
      const { limit, windowSec } = limits[scope];
      return deps.store.consume(`${scope}:${key}`, { capacity: limit, refillPerSec: limit / windowSec }, deps.now());
    },
  };
}

type DefaultRateLimiter = {
  check(scope: RateLimitScope, key: string): Promise<ConsumeResult>;
  invalidateLimits(): void;
};

let instance: { limiter: ReturnType<typeof createRateLimiter>; limits: LimitsProvider } | undefined;
let warned = false;

function build() {
  const redisUrl = getEnv().REDIS_URL;
  let store: RateLimitStore;
  if (redisUrl) {
    store = new RedisRateLimitStore(getRedisClient(redisUrl));
  } else {
    if (process.env.NODE_ENV === "production" && !warned) {
      warned = true;
      console.warn(
        "[rate-limit] REDIS_URL is not set: using a per-process in-memory store. Limits are not shared across instances.",
      );
    }
    store = new MemoryRateLimitStore();
  }
  const now = () => Date.now();
  const limits = createLimitsProvider({ load: () => settingRepository.get("rateLimits"), now });
  return { limiter: createRateLimiter({ store, limits, now }), limits };
}

function getInstance() {
  instance ??= build();
  return instance;
}

/** The process-wide limiter, built on first use. */
export const rateLimiter: DefaultRateLimiter = {
  check: (scope, key) => getInstance().limiter.check(scope, key),
  invalidateLimits: () => getInstance().limits.invalidate(),
};
