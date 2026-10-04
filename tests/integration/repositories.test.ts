import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import type { SnippetId, UserId } from "@/core/shared/ids";
import { inTransaction } from "@/server/db/transaction";
import { auditRepository } from "@/server/repositories/auditRepository";
import { roleRepository } from "@/server/repositories/roleRepository";
import { settingRepository } from "@/server/repositories/settingRepository";
import { snippetRepository } from "@/server/repositories/snippetRepository";
import type { UserRecord } from "@/server/repositories/types";
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

const input = (email = "a@b.co") => ({ email, passwordHash: "hash", displayName: "A" });

async function makeUser(email = "a@b.co"): Promise<UserRecord> {
  const result = await userRepository.create(input(email));
  if (!result.ok) throw new Error("setup: user not created");
  return result.user;
}

describe("userRepository", () => {
  it("returns plain objects with a string id and Date fields", async () => {
    const user = await makeUser();
    const found = await userRepository.findById(user.id);
    for (const u of [user, found]) {
      expect(u).not.toBeNull();
      expect(Object.getPrototypeOf(u)).toBe(Object.prototype);
      expect(u).not.toHaveProperty("_id");
      expect(u).not.toHaveProperty("__v");
      expect(u?.id).toMatch(/^[0-9a-f]{24}$/);
      expect(u?.createdAt).toBeInstanceOf(Date);
      expect(u?.updatedAt).toBeInstanceOf(Date);
    }
    expect(found).toMatchObject({
      email: "a@b.co",
      role: "user",
      status: "active",
      sessionVersion: 0,
      lastLoginAt: null,
    });
  });

  it("maps a duplicate email to email_taken", async () => {
    await makeUser();
    expect(await userRepository.create(input())).toEqual({ ok: false, reason: "email_taken" });
  });

  it("finds by email case-insensitively", async () => {
    const user = await makeUser("a@b.co");
    expect((await userRepository.findByEmail(" A@B.co "))?.id).toBe(user.id);
  });

  it("records the login time", async () => {
    const user = await makeUser();
    const at = new Date("2026-01-02T03:04:05.000Z");
    await userRepository.recordLogin(user.id, at);
    expect((await userRepository.findById(user.id))?.lastLoginAt).toEqual(at);
  });

  it.each([
    ["setRole", (id: UserId) => userRepository.setRole(id, "admin")],
    ["setStatus", (id: UserId) => userRepository.setStatus(id, "banned")],
    ["setPasswordHash", (id: UserId) => userRepository.setPasswordHash(id, "new-hash")],
  ])("%s increments sessionVersion by exactly 1 and returns the updated user", async (_name, write) => {
    const user = await makeUser();
    const updated = await write(user.id);
    expect(updated?.sessionVersion).toBe(1);
    expect((await userRepository.findById(user.id))?.sessionVersion).toBe(1);
  });

  it("applies each write's own field", async () => {
    const user = await makeUser();
    expect((await userRepository.setRole(user.id, "admin"))?.role).toBe("admin");
    expect((await userRepository.setStatus(user.id, "banned"))?.status).toBe("banned");
    expect((await userRepository.setPasswordHash(user.id, "h2"))?.passwordHash).toBe("h2");
  });

  it.each([
    ["setRole with an unknown role", (id: UserId) => userRepository.setRole(id, "superadmin" as never)],
    ["setStatus with an unknown status", (id: UserId) => userRepository.setStatus(id, "x" as never)],
    ["setRole with an operator object", (id: UserId) => userRepository.setRole(id, { $ne: "user" } as never)],
    ["setPasswordHash with a number", (id: UserId) => userRepository.setPasswordHash(id, 123 as never)],
    ["setPasswordHash with an empty string", (id: UserId) => userRepository.setPasswordHash(id, "")],
  ])("%s is rejected and leaves the row and sessionVersion unchanged", async (_name, write) => {
    const user = await makeUser();
    await expect(write(user.id)).rejects.toThrow(TypeError);
    const after = await userRepository.findById(user.id);
    expect(after).toEqual(user);
    expect(after?.sessionVersion).toBe(0);
  });

  it("returns null when writing to an unknown user", async () => {
    expect(await userRepository.setRole("0".repeat(24) as UserId, "admin")).toBeNull();
  });

  it("counts active users by role", async () => {
    const a = await makeUser("a@b.co");
    const b = await makeUser("b@b.co");
    await makeUser("c@b.co");
    await userRepository.setRole(a.id, "admin");
    await userRepository.setRole(b.id, "admin");
    await userRepository.setStatus(b.id, "banned");
    expect(await userRepository.countActiveByRole("admin")).toBe(1);
    expect(await userRepository.countActiveByRole("user")).toBe(1);
  });

  it("passes the session through (a rolled-back create leaves nothing)", async () => {
    await expect(
      inTransaction(async (session) => {
        await userRepository.create(input(), session);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await userRepository.findByEmail("a@b.co")).toBeNull();
  });

  describe("operator injection", () => {
    it("findByEmail does not treat an object as an operator", async () => {
      await makeUser();
      expect(await userRepository.findByEmail({ $ne: null } as unknown as string)).toBeNull();
    });

    it("findById never returns a user for an operator object", async () => {
      await makeUser();
      const result = await userRepository.findById({ $ne: null } as unknown as UserId).catch(() => null);
      expect(result).toBeNull();
    });
  });
});

describe("snippetRepository", () => {
  async function makeSnippet(ownerId: UserId, title = "t") {
    return snippetRepository.create({ ownerId, title, source: "1", lang: "js" });
  }

  it("creates and finds a plain snippet by slug", async () => {
    const owner = await makeUser();
    const snippet = await makeSnippet(owner.id);
    const found = await snippetRepository.findBySlug(snippet.slug);
    expect(Object.getPrototypeOf(found)).toBe(Object.prototype);
    expect(found).not.toHaveProperty("_id");
    expect(found).toMatchObject({
      id: snippet.id,
      ownerId: owner.id,
      title: "t",
      visibility: "private",
      forkedFrom: null,
      stats: { views: 0, forks: 0 },
    });
    expect(snippet.slug).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it("lists snippets by owner, newest first", async () => {
    const owner = await makeUser();
    const other = await makeUser("o@b.co");
    const first = await makeSnippet(owner.id, "first");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await makeSnippet(owner.id, "second");
    await makeSnippet(other.id, "other");
    const list = await snippetRepository.listByOwner(owner.id);
    expect(list.map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it("findBySlug does not treat an object as an operator", async () => {
    const owner = await makeUser();
    await makeSnippet(owner.id);
    expect(await snippetRepository.findBySlug({ $ne: null } as unknown as string)).toBeNull();
  });

  it("listByOwner never matches for an operator object", async () => {
    const owner = await makeUser();
    await makeSnippet(owner.id);
    const result = await snippetRepository.listByOwner({ $ne: null } as unknown as UserId).catch(() => []);
    expect(result).toEqual([]);
  });

  it("round-trips forkedFrom as a SnippetId", async () => {
    const owner = await makeUser();
    const parent = await makeSnippet(owner.id);
    const fork = await snippetRepository.create({
      ownerId: owner.id,
      title: "f",
      source: "1",
      lang: "js",
      forkedFrom: parent.id as SnippetId,
    });
    expect(fork.forkedFrom).toBe(parent.id);
  });
});

describe("roleRepository", () => {
  it("upserts roles idempotently and finds by name", async () => {
    await roleRepository.upsertAll([
      { name: "user", permissions: ["snippet:read"] },
      { name: "admin", permissions: ["snippet:read", "user:ban"] },
    ]);
    await roleRepository.upsertAll([{ name: "user", permissions: ["snippet:read", "snippet:write"] }]);
    const user = await roleRepository.findByName("user");
    expect(user).toEqual({ name: "user", permissions: ["snippet:read", "snippet:write"] });
    expect(Object.getPrototypeOf(user)).toBe(Object.prototype);
    expect((await roleRepository.findByName("admin"))?.permissions).toEqual(["snippet:read", "user:ban"]);
  });

  it("returns null for an absent role", async () => {
    expect(await roleRepository.findByName("admin")).toBeNull();
  });
});

describe("settingRepository", () => {
  it("returns null for an absent key, then the stored value", async () => {
    expect(await settingRepository.get("k")).toBeNull();
    await settingRepository.set("k", { a: [1, 2] });
    expect(await settingRepository.get("k")).toEqual({ a: [1, 2] });
    await settingRepository.set("k", 3);
    expect(await settingRepository.get("k")).toBe(3);
  });

  it("touch bumps a counter without changing the value", async () => {
    await settingRepository.set("t", "keep");
    await inTransaction((session) => settingRepository.touch("t", session));
    await inTransaction((session) => settingRepository.touch("t", session));
    expect(await settingRepository.get("t")).toBe("keep");
    const raw = await mongoose.connection.collection("settings").findOne({ key: "t" });
    expect(raw?.["touches"]).toBe(2);
  });

  it("touch creates a missing key with a null value", async () => {
    await settingRepository.touch("new");
    expect(await settingRepository.get("new")).toBeNull();
    const raw = await mongoose.connection.collection("settings").findOne({ key: "new" });
    expect(raw?.["touches"]).toBe(1);
  });
});

describe("auditRepository", () => {
  const record = (event: string, at: string) => ({
    event,
    severity: "info" as const,
    ipHash: "ip",
    requestId: "r",
    at: new Date(at),
  });

  it("lists recent entries, newest first, filtered by event and limited", async () => {
    await auditRepository.insertMany([
      record("x", "2026-01-01T00:00:00Z"),
      record("y", "2026-01-02T00:00:00Z"),
      record("x", "2026-01-03T00:00:00Z"),
      record("x", "2026-01-04T00:00:00Z"),
    ]);
    const list = await auditRepository.listRecent({ event: "x", limit: 2 });
    expect(list.map((e) => e.at.toISOString())).toEqual(["2026-01-04T00:00:00.000Z", "2026-01-03T00:00:00.000Z"]);
    expect(list.every((e) => e.event === "x")).toBe(true);
    expect(Object.getPrototypeOf(list[0])).toBe(Object.prototype);
    expect(list[0]).not.toHaveProperty("_id");
  });

  it("lists across events when no event is given and keeps optional fields", async () => {
    const actor = await makeUser();
    await auditRepository.insertMany([
      { ...record("z", "2026-02-01T00:00:00Z"), actorId: actor.id, details: { n: 1 }, codeHash: "c" },
    ]);
    const [entry] = await auditRepository.listRecent({ limit: 10 });
    expect(entry).toMatchObject({ event: "z", actorId: actor.id, details: { n: 1 }, codeHash: "c", severity: "info" });
  });

  it("insertMany of nothing is a no-op", async () => {
    await auditRepository.insertMany([]);
    expect(await auditRepository.listRecent({ limit: 5 })).toEqual([]);
  });

  it("an event filter object is not an operator", async () => {
    await auditRepository.insertMany([record("x", "2026-01-01T00:00:00Z")]);
    const result = await auditRepository
      .listRecent({ event: { $ne: null } as unknown as string, limit: 5 })
      .catch(() => []);
    expect(result).toEqual([]);
  });
});
