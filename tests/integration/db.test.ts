import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectDb } from "@/server/db/connection";
import { inTransaction } from "@/server/db/transaction";
import { userRepository } from "@/server/repositories/userRepository";
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

// Models are private to server/repositories/ and server/db/ (ESLint), so this
// file reads collections through the connection handle. `mongoose.model(name)`
// returns the already-registered model without importing it.
const settings = () => mongoose.connection.collection("settings");

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
    await expect(mongoose.model("User").find({ nope: 1 } as never).exec()).rejects.toThrow();
  });
});

describe("indexes", () => {
  it("makes User.email unique", async () => {
    // Asserts the index the MODEL declared (ensureIndexes built it; reset() keeps indexes).
    const indexes = await mongoose.connection.collection("users").indexes();
    expect(indexes).toContainEqual(expect.objectContaining({ key: { email: 1 }, unique: true }));
    expect(await userRepository.create(newUser())).toMatchObject({ ok: true });
    expect(await userRepository.create(newUser())).toEqual({ ok: false, reason: "email_taken" });
  });

  it("gives AuditLog a 90-day TTL index on `at`", async () => {
    const indexes = await mongoose.connection.collection("auditlogs").indexes();
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { at: 1 }, expireAfterSeconds: 7_776_000 }),
    );
  });
});

describe("inTransaction", () => {
  it("commits on success", async () => {
    await inTransaction(async (session) => {
      await settings().insertOne({ key: "k", value: 1 }, { session });
    });
    expect(await settings().countDocuments()).toBe(1);
  });

  it("rolls back when the callback throws", async () => {
    await expect(
      inTransaction(async (session) => {
        await settings().insertOne({ key: "k", value: 1 }, { session });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await settings().countDocuments()).toBe(0);
  });
});
