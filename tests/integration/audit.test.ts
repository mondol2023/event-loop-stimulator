import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogger, hashCode } from "@/server/audit/AuditLogger";
import { auditRepository } from "@/server/repositories/auditRepository";
import { startTestDb } from "./helpers/db";

type TestDb = Awaited<ReturnType<typeof startTestDb>>;
let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
}, 120_000);

afterAll(async () => {
  await db.stop();
}, 60_000);

beforeEach(async () => {
  await db.reset();
});

describe("auditLogger (singleton, Mongo sink)", () => {
  it("persists flushed entries so listRecent returns them, without sensitive detail keys", async () => {
    auditLogger.log({
      event: "compile.rejected",
      severity: "warn",
      ipHash: "ip-1",
      requestId: "req-int-1",
      codeHash: hashCode("while(true){}"),
      details: { reason: "too long", source: "while(true){}", count: 3 },
    });
    auditLogger.log({ event: "compile.rejected", severity: "info", ipHash: "ip-1", requestId: "req-int-2" });
    await auditLogger.flush();
    expect(auditLogger.dropped).toBe(0);

    const list = await auditRepository.listRecent({ event: "compile.rejected", limit: 10 });
    expect(list.map((r) => r.requestId).sort()).toEqual(["req-int-1", "req-int-2"]);
    const first = list.find((r) => r.requestId === "req-int-1");
    expect(first?.details).toEqual({ reason: "too long", count: 3 });
    expect(first?.codeHash).toBe(hashCode("while(true){}"));
  });

  it("is registered as a single instance on globalThis", () => {
    expect((globalThis as Record<string, unknown>)["__siliconLoopAudit"]).toBe(auditLogger);
  });
});
