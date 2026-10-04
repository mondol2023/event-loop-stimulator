import "server-only";
import { Redis } from "ioredis";

/**
 * A Redis client tuned to fail fast. With ioredis defaults, commands queue while
 * disconnected and retry ~20 times, so a Redis outage would hang every
 * rate-limited request for many seconds. Here a command retries once
 * (maxRetriesPerRequest) and times out in 2 s (commandTimeout). The offline
 * queue must stay ON: `lazyConnect` means the first command is issued before the
 * stream is writable, and with the queue off ioredis would reject it outright.
 * `lazyConnect` also means constructing this (or importing the module) never
 * touches the network.
 */
export function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: true,
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
