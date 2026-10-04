import "server-only";
import { Redis } from "ioredis";

/**
 * A Redis client tuned to fail fast. With ioredis defaults, commands queue while
 * disconnected and retry ~20 times, so a Redis outage would hang every
 * rate-limited request for many seconds. Here commands reject immediately when
 * offline (no offline queue), retry once, and time out in 2 s. `lazyConnect`
 * means constructing it (and importing this module) never touches the network.
 */
export function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
  });
  // Without a listener ioredis logs "Unhandled error event" on every failed
  // reconnect. Log once per outage; the command-level rejection is what callers see.
  let logged = false;
  client.on("error", (err: Error) => {
    if (logged) return;
    logged = true;
    console.error(`[rate-limit] Redis error: ${err.message}`);
  });
  client.on("ready", () => {
    logged = false;
  });
  return client;
}

const globalForRedis = globalThis as unknown as { __siliconLoopRateLimitRedis?: { url: string; client: Redis } };

/** One client per process (survives dev HMR, which re-evaluates modules). */
export function getRedisClient(url: string): Redis {
  const existing = globalForRedis.__siliconLoopRateLimitRedis;
  if (existing?.url === url) return existing.client;
  existing?.client.disconnect();
  const client = createRedisClient(url);
  globalForRedis.__siliconLoopRateLimitRedis = { url, client };
  return client;
}
