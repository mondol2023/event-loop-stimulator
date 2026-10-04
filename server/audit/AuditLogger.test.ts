import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRequestContext = vi.fn();
vi.mock("@/server/security/requestContext", () => ({
  getRequestContext: () => getRequestContext(),
}));
vi.mock("@/server/repositories/auditRepository", () => ({
  auditRepository: { insertMany: vi.fn(async () => undefined) },
}));

import { AuditLogger, hashCode, withAudit, type AuditEntry } from "./AuditLogger";
import type { UserId } from "@/core/shared/ids";

const VALID_ID = "0123456789abcdef01234567" as UserId;

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  event: "auth.login",
  severity: "info",
  ipHash: "iphash",
  requestId: "req-1",
  ...over,
});

function makeSink() {
  const batches: AuditEntry[][] = [];
  const sink = vi.fn(async (entries: readonly AuditEntry[]) => {
    batches.push([...entries]);
  });
  return { sink, batches };
}

describe("AuditLogger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("log returns undefined synchronously and the sink is not called until flush", async () => {
    const { sink, batches } = makeSink();
    const logger = new AuditLogger({ sink });
    expect(logger.log(entry())).toBeUndefined();
    expect(sink).not.toHaveBeenCalled();
    await logger.flush();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(batches[0]).toHaveLength(1);
  });

  it("flush delivers entries in order", async () => {
    const { sink, batches } = makeSink();
    const logger = new AuditLogger({ sink });
    logger.log(entry({ requestId: "a" }));
    logger.log(entry({ requestId: "b" }));
    logger.log(entry({ requestId: "c" }));
    await logger.flush();
    expect(batches.flat().map((e) => e.requestId)).toEqual(["a", "b", "c"]);
  });

  it("flush with an empty queue does not call the sink", async () => {
    const { sink } = makeSink();
    await new AuditLogger({ sink }).flush();
    expect(sink).not.toHaveBeenCalled();
  });

  it("drops the oldest entries when the queue is full and counts them", async () => {
    const { sink, batches } = makeSink();
    const logger = new AuditLogger({ sink, maxQueue: 3 });
    for (const id of ["1", "2", "3", "4", "5"]) logger.log(entry({ requestId: id }));
    expect(logger.dropped).toBe(2);
    await logger.flush();
    expect(batches.flat().map((e) => e.requestId)).toEqual(["3", "4", "5"]);
  });

  it("a rejecting sink does not throw from flush, increments dropped and logs only the count", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sink = vi.fn(async () => {
      throw new Error("boom with secret-detail");
    });
    const logger = new AuditLogger({ sink });
    logger.log(entry({ details: { reason: "x" } }));
    logger.log(entry());
    await expect(logger.flush()).resolves.toBeUndefined();
    expect(logger.dropped).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
    const printed = JSON.stringify(error.mock.calls);
    expect(printed).toContain("dropped 2 entries");
    expect(printed).not.toContain("secret-detail");
    expect(printed).not.toContain("req-1");
    expect(printed).not.toContain("iphash");
  });

  it("a synchronously throwing sink is handled the same way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = new AuditLogger({
      sink: () => {
        throw new Error("sync");
      },
    });
    logger.log(entry());
    await expect(logger.flush()).resolves.toBeUndefined();
    expect(logger.dropped).toBe(1);
  });

  it("removes sensitive detail keys before queueing", async () => {
    const { sink, batches } = makeSink();
    const logger = new AuditLogger({ sink });
    logger.log(
      entry({
        details: { code: "evil()", reason: "x", Password: "p", clientSecret: "s", accessToken: "t", sourceMap: "m", n: 1 },
      }),
    );
    await logger.flush();
    expect(batches[0]?.[0]?.details).toEqual({ reason: "x", n: 1 });
  });

  it("only forwards known fields (no smuggled source)", async () => {
    const { sink, batches } = makeSink();
    const logger = new AuditLogger({ sink });
    logger.log({ ...entry(), source: "while(1){}" } as unknown as AuditEntry);
    await logger.flush();
    expect(batches[0]?.[0]).not.toHaveProperty("source");
  });

  it("snapshots the entry at log time (later mutation does not leak in)", async () => {
    const { sink, batches } = makeSink();
    const logger = new AuditLogger({ sink });
    const details = { reason: "x" };
    logger.log(entry({ details }));
    details.reason = "mutated";
    await logger.flush();
    expect(batches[0]?.[0]?.details).toEqual({ reason: "x" });
  });

  it("never throws on malformed input", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { sink } = makeSink();
    const logger = new AuditLogger({ sink });
    const throwing = {
      get event(): string {
        throw new Error("getter");
      },
    };
    const bad: unknown[] = [undefined, null, 5, "x", { details: 5 }, { details: { a: { b: 1 } } }, throwing];
    for (const b of bad) expect(() => logger.log(b as AuditEntry)).not.toThrow();
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  it("drops invalid entries (counted, never queued) without poisoning neighbouring valid ones", async () => {
    const { sink, batches } = makeSink();
    const logger = new AuditLogger({ sink });
    const bads: unknown[] = [
      undefined,
      { ...entry(), event: undefined },
      { ...entry(), event: 5 },
      { ...entry(), severity: "fatal" },
      { ...entry(), severity: undefined },
      { ...entry(), ipHash: 1 },
      { ...entry(), requestId: undefined },
      { ...entry(), actorId: "u1" },
      { ...entry(), actorId: 7 },
      { ...entry(), details: 5 },
      { ...entry(), codeHash: 5 },
    ];
    logger.log(entry({ requestId: "good-1" }));
    for (const b of bads) expect(() => logger.log(b as AuditEntry)).not.toThrow();
    logger.log(entry({ requestId: "good-2", actorId: VALID_ID }));
    expect(logger.dropped).toBe(bads.length);
    await logger.flush();
    expect(batches.flat().map((e) => e.requestId)).toEqual(["good-1", "good-2"]);
  });

  it("truncates over-long strings instead of dropping the entry", async () => {
    const { sink, batches } = makeSink();
    const logger = new AuditLogger({ sink });
    const long = "x".repeat(10_000);
    logger.log(entry({ requestId: long, ipHash: long, codeHash: long, details: { reason: long, n: 1 } }));
    await logger.flush();
    const got = batches[0]?.[0];
    expect(logger.dropped).toBe(0);
    expect(got?.requestId).toHaveLength(128);
    expect(got?.ipHash).toHaveLength(128);
    expect(got?.codeHash).toHaveLength(128);
    expect(got?.details?.["reason"]).toHaveLength(256);
    expect(got?.details?.["n"]).toBe(1);
  });

  it("a failing sink drops only that batch; later entries are delivered in order", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const delivered: string[] = [];
    let calls = 0;
    const logger = new AuditLogger({
      sink: async (entries) => {
        calls += 1;
        if (calls === 1) throw new Error("down");
        delivered.push(...entries.map((e) => e.requestId));
      },
    });
    logger.log(entry({ requestId: "lost-1" }));
    logger.log(entry({ requestId: "lost-2" }));
    await logger.flush();
    expect(logger.dropped).toBe(2);
    logger.log(entry({ requestId: "kept-1" }));
    logger.log(entry({ requestId: "kept-2" }));
    await logger.flush();
    expect(delivered).toEqual(["kept-1", "kept-2"]);
    expect(logger.dropped).toBe(2);
  });

  it("flushes on a timer after flushDelayMs, and the timer is unref'd", async () => {
    const unref = vi.fn();
    const realSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      const t = realSetTimeout(fn, ms);
      const original = t.unref.bind(t);
      t.unref = () => {
        unref();
        return original();
      };
      return t;
    }) as unknown as typeof setTimeout);
    const { sink } = makeSink();
    const logger = new AuditLogger({ sink, flushDelayMs: 250 });
    logger.log(entry());
    logger.log(entry());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(sink).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("entries logged during an in-flight flush are delivered later, in order", async () => {
    const batches: string[][] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const logger = new AuditLogger({
      sink: async (entries) => {
        if (first) {
          first = false;
          await gate;
        }
        batches.push(entries.map((e) => e.requestId));
      },
    });
    logger.log(entry({ requestId: "a" }));
    const f1 = logger.flush();
    logger.log(entry({ requestId: "b" }));
    const f2 = logger.flush();
    release();
    await Promise.all([f1, f2]);
    expect(batches.flat()).toEqual(["a", "b"]);
  });
});

describe("hashCode", () => {
  it("is the hex SHA-256", () => {
    expect(hashCode("a")).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
    expect(hashCode("a")).toBe(createHash("sha256").update("a").digest("hex"));
  });
});

describe("withAudit", () => {
  beforeEach(() => {
    getRequestContext.mockResolvedValue({ requestId: "rid", ipHash: "ih" });
  });
  afterEach(() => {
    getRequestContext.mockReset();
  });

  const loggerWith = () => {
    const { sink, batches } = makeSink();
    const logger = new AuditLogger({ sink });
    return { logger, batches };
  };

  it("logs once on success with the result-derived actor and request context", async () => {
    const { logger, batches } = loggerWith();
    const wrapped = withAudit(async (email: string) => ({ id: VALID_ID, email }), {
      logger,
      event: "auth.register",
      actor: ({ result }) => result?.id,
      details: ({ args, result }) => ({ email: args[0], ok: result !== undefined }),
    });
    await expect(wrapped("a@b.c")).resolves.toEqual({ id: VALID_ID, email: "a@b.c" });
    await logger.flush();
    expect(batches.flat()).toEqual([
      {
        event: "auth.register",
        severity: "info",
        actorId: VALID_ID,
        ipHash: "ih",
        requestId: "rid",
        details: { email: "a@b.c", ok: true },
      },
    ]);
  });

  it("logs once on failure and rethrows the original error", async () => {
    const { logger, batches } = loggerWith();
    const err = new Error("nope");
    const wrapped = withAudit(
      async (...args: number[]): Promise<string> => {
        void args;
        throw err;
      },
      {
        logger,
        event: "auth.logout",
        severity: "warn",
        details: ({ error }) => ({ failed: error instanceof Error }),
      },
    );
    await expect(wrapped(1)).rejects.toBe(err);
    await logger.flush();
    expect(batches.flat()).toHaveLength(1);
    expect(batches[0]?.[0]).toMatchObject({ event: "auth.logout", severity: "warn", details: { failed: true } });
  });

  it("does not break the wrapped call when context, actor or details throw", async () => {
    const { logger, batches } = loggerWith();
    getRequestContext.mockRejectedValue(new Error("outside request scope"));
    const wrapped = withAudit(async () => 42, {
      logger,
      event: "auth.password_changed",
      actor: () => {
        throw new Error("actor");
      },
      details: () => {
        throw new Error("details");
      },
    });
    await expect(wrapped()).resolves.toBe(42);
    await logger.flush();
    expect(batches.flat()).toHaveLength(1);
  });
});
