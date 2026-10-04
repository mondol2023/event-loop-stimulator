import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectDb } from "@/server/db/connection";
import { Setting } from "@/server/db/models/Setting";
import { AuditLog } from "@/server/db/models/AuditLog";
import { User } from "@/server/db/models/User";
import { inTransaction } from "@/server/db/transaction";
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

const newUser = (email = "a@example.com") => ({ email, passwordHash: "hash", displayName: "A" });

describe("connectDb", () => {
  it("returns the same cached connection on repeat calls", async () => {
    const a = await connectDb(db.uri);
    const b = await connectDb(db.uri);
    expect(a).toBe(b);
    expect(mongoose.connection.readyState).toBe(1);
  });
});

describe("global mongoose options", () => {
  it("sets sanitizeFilter and strictQuery:throw", () => {
    expect(mongoose.get("sanitizeFilter")).toBe(true);
    expect(mongoose.get("strictQuery")).toBe("throw");
  });

  it("rejects queries on unknown paths", async () => {
    await expect(User.find({ nope: 1 } as never).exec()).rejects.toThrow();
  });
});

describe("indexes", () => {
  it("makes User.email unique", async () => {
    await User.create(newUser());
    await expect(User.create(newUser())).rejects.toMatchObject({ code: 11000 });
  });

  it("gives AuditLog a 90-day TTL index on `at`", async () => {
    const indexes = await AuditLog.collection.indexes();
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { at: 1 }, expireAfterSeconds: 7_776_000 }),
    );
  });
});

describe("inTransaction", () => {
  it("commits on success", async () => {
    await inTransaction(async (session) => {
      await Setting.create([{ key: "k", value: 1 }], { session });
    });
    expect(await Setting.countDocuments()).toBe(1);
  });

  it("rolls back when the callback throws", async () => {
    await expect(
      inTransaction(async (session) => {
        await Setting.create([{ key: "k", value: 1 }], { session });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await Setting.countDocuments()).toBe(0);
  });
});
