import { Redis } from "ioredis";
import { afterAll, describe } from "vitest";
import { RedisRateLimitStore } from "./redisStore";
import { runStoreContract } from "./store.contract";

// Runs only when a real Redis is reachable: set REDIS_TEST_URL=redis://localhost:6379
// (e.g. `docker compose --profile redis up -d`). Test-only switch, so it reads process.env directly.
const url = process.env.REDIS_TEST_URL;
const clients: Redis[] = [];

describe.skipIf(!url)("RedisRateLimitStore (REDIS_TEST_URL)", () => {
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.quit()));
  });
  runStoreContract(() => {
    const redis = new Redis(url!);
    clients.push(redis);
    return new RedisRateLimitStore(redis);
  });
});
