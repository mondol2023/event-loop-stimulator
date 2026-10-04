import { afterEach, describe, expect, it } from "vitest";
import { createRedisClient } from "./redisClient";

const clients: ReturnType<typeof createRedisClient>[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect();
});

describe("createRedisClient", () => {
  it("fails fast: no offline queue, tiny retry budget, short timeouts, lazy connect", () => {
    const client = createRedisClient("redis://localhost:6379");
    clients.push(client);
    expect(client.options.lazyConnect).toBe(true);
    expect(client.options.enableOfflineQueue).toBe(false);
    expect(client.options.maxRetriesPerRequest).toBe(1);
    expect(client.options.connectTimeout).toBeLessThanOrEqual(3000);
    expect(client.options.commandTimeout).toBeLessThanOrEqual(3000);
    expect(client.status).toBe("wait"); // constructing did not connect
  });

  it("attaches an error listener so connection errors do not crash or spam", () => {
    const client = createRedisClient("redis://localhost:6379");
    clients.push(client);
    expect(client.listenerCount("error")).toBeGreaterThanOrEqual(1);
    expect(() => client.emit("error", new Error("ECONNREFUSED"))).not.toThrow();
  });
});
