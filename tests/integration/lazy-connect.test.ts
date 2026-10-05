import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Nothing in the app calls connectDb() at boot, so the data layer must connect on first use.
const env = vi.hoisted(() => ({ uri: "mongodb://127.0.0.1:1/unreachable?directConnection=true" }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ SESSION_SECRET: "s".repeat(48), MONGODB_URI: env.uri }),
}));

import { disconnectDb } from "@/server/db/connection";
import { ensureIndexes } from "@/server/db/indexes";
import { inTransaction } from "@/server/db/transaction";
import { settingRepository } from "@/server/repositories/settingRepository";
import { userRepository } from "@/server/repositories/userRepository";

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
}, 120_000);

afterAll(async () => {
  await disconnectDb();
  await replSet.stop();
}, 60_000);

describe("lazy connection", () => {
  it("fails fast while the database is unreachable (no 10 s query buffering)", async () => {
    const started = Date.now();
    await expect(settingRepository.get("rateLimits")).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(6000);
  }, 15_000);

  it("recovers on the next call once the database is reachable, with no explicit connectDb()", async () => {
    env.uri = replSet.getUri();
    await settingRepository.set("probe", { n: 1 });
    expect(await settingRepository.get("probe")).toEqual({ n: 1 });
    await ensureIndexes();
    expect(await userRepository.findByEmail("nobody@example.com")).toBeNull();
  }, 30_000);

  it("opens the connection for transactions too", async () => {
    await disconnectDb();
    env.uri = replSet.getUri();
    const result = await inTransaction(async (session) => {
      await settingRepository.set("in-tx", { ok: true }, session);
      return "committed";
    });
    expect(result).toBe("committed");
    expect(await settingRepository.get("in-tx")).toEqual({ ok: true });
  }, 30_000);
});
