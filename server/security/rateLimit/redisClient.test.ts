import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createRedisClient } from "./redisClient";

const clients: ReturnType<typeof createRedisClient>[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe("createRedisClient", () => {
  it("is lazy, bounded by timeouts, and queues commands issued before the first connect", () => {
    const client = createRedisClient("redis://localhost:6379");
    clients.push(client);
    expect(client.options.lazyConnect).toBe(true);
    // Must be true: with lazyConnect the first command arrives before the
    // stream is writable; with the queue off ioredis rejects it outright.
    expect(client.options.enableOfflineQueue).toBe(true);
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

  it("rejects within a bounded time against an unreachable server, after actually trying", async () => {
    const client = createRedisClient("redis://127.0.0.1:1");
    clients.push(client);
    const started = Date.now();
    const err = await client.ping().then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).not.toMatch(/writeable/i);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10_000);

  it("runs the very first command on a lazy client (tiny RESP server)", async () => {
    // Answers INFO (ioredis ready check) and PING; arguments start with "$", so only command starts match.
    const server = createServer((socket) => {
      socket.on("data", (buf) => {
        for (const m of buf.toString().matchAll(/\*\d+\r\n\$\d+\r\n(\w+)\r\n/g)) {
          if (m[1]?.toUpperCase() === "INFO") {
            const body = "# Server\r\nredis_version:7.0.0\r\nloading:0\r\n";
            socket.write(`$${body.length}\r\n${body}\r\n`);
          } else socket.write("+PONG\r\n");
        }
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const client = createRedisClient(`redis://127.0.0.1:${(server.address() as AddressInfo).port}`);
    clients.push(client);
    expect(await client.ping()).toBe("PONG");
  }, 10_000);
});
