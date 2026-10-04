import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { installFakeRequest, type FakeRequest } from "./helpers/fakeNext";
import { startTestDb } from "./helpers/db";

vi.mock("@/server/env", () => ({
  getEnv: () => ({ SESSION_SECRET: "s".repeat(48), MONGODB_URI: "mongodb://localhost/test" }),
}));

import { auditLogger } from "@/server/audit/AuditLogger";
import { authorize, getCurrentUser, invalidateRoleCache, requireRole, requireUser } from "@/server/auth/dal";
import { SESSION_COOKIE_NAME, getSession } from "@/server/auth/session";
import { seed } from "@/server/db/seed";
import { auditRepository } from "@/server/repositories/auditRepository";
import type { RoleName } from "@/server/repositories/types";
import { userRepository } from "@/server/repositories/userRepository";

type TestDb = Awaited<ReturnType<typeof startTestDb>>;
let db: TestDb;
let req: FakeRequest;

beforeAll(async () => {
  db = await startTestDb();
}, 120_000);

afterAll(async () => {
  await db.stop();
}, 60_000);

beforeEach(async () => {
  await db.reset();
  await seed();
  invalidateRoleCache();
  req = installFakeRequest();
  req.setIp("203.0.113.9");
});

async function makeUser(role: RoleName = "user", email = `${role}@example.com`) {
  const created = await userRepository.create({ email, passwordHash: "hash-not-exposed", displayName: "Test", role });
  if (!created.ok) throw new Error("setup: user not created");
  return created.user;
}

/** Signs `user` in by writing a real sealed cookie into the fake jar. */
async function signIn(user: { id: string; role: RoleName; sessionVersion: number }) {
  const session = await getSession();
  session.userId = user.id;
  session.role = user.role;
  session.sessionVersion = user.sessionVersion;
  await session.save();
}

const rawUsers = () => mongoose.connection.db!.collection("users");
const oid = (id: string) => new mongoose.Types.ObjectId(id);

describe("getCurrentUser", () => {
  it("is null with no cookie", async () => {
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns a DTO for a valid session, with role permissions and no passwordHash", async () => {
    const user = await makeUser("user");
    await signIn(user);
    const current = await getCurrentUser();
    expect(current).toEqual({
      id: user.id,
      email: "user@example.com",
      displayName: "Test",
      role: "user",
      permissions: expect.arrayContaining(["compile", "snippet:create"]),
    });
    expect(current?.permissions).not.toContain("user:ban");
    expect(JSON.stringify(current)).not.toContain("passwordHash");
    expect(JSON.stringify(current)).not.toContain("hash-not-exposed");
    expect(current).not.toHaveProperty("passwordHash");
    expect(current).not.toHaveProperty("sessionVersion");
  });

  it("is null for a tampered cookie", async () => {
    const user = await makeUser();
    await signIn(user);
    const sealed = req.cookies.get(SESSION_COOKIE_NAME)!;
    const i = Math.floor(sealed.length / 2);
    req.cookies.set(SESSION_COOKIE_NAME, sealed.slice(0, i) + (sealed[i] === "A" ? "B" : "A") + sealed.slice(i + 1));
    expect(await getCurrentUser()).toBeNull();
  });

  it("is null for a banned user even with a still-valid cookie", async () => {
    const user = await makeUser();
    await signIn(user);
    // Raw write: no sessionVersion bump, so only the status check can stop this.
    await rawUsers().updateOne({ _id: oid(user.id) }, { $set: { status: "banned" } });
    expect(await getCurrentUser()).toBeNull();
  });

  it("is null for a user with an unknown status value (fail closed)", async () => {
    const user = await makeUser();
    await signIn(user);
    await rawUsers().updateOne({ _id: oid(user.id) }, { $set: { status: "suspended" } });
    expect(await getCurrentUser()).toBeNull();
  });

  it("is revoked when sessionVersion changes (role change)", async () => {
    const user = await makeUser();
    await signIn(user);
    expect(await getCurrentUser()).not.toBeNull();
    await userRepository.setRole(user.id, "admin");
    expect(await getCurrentUser()).toBeNull();
  });

  it("is revoked when sessionVersion changes (ban via repository)", async () => {
    const user = await makeUser();
    await signIn(user);
    await userRepository.setStatus(user.id, "banned");
    expect(await getCurrentUser()).toBeNull();
  });

  it("is null when the user no longer exists", async () => {
    const user = await makeUser();
    await signIn(user);
    await rawUsers().deleteMany({});
    expect(await getCurrentUser()).toBeNull();
  });

  it("is null, without throwing, for a malformed userId or sessionVersion in a validly sealed cookie", async () => {
    const bad: [unknown, unknown][] = [
      ["not-an-object-id", 0],
      ["", 0],
      ["a".repeat(23), 0],
      [{ $ne: null }, 0],
      ["a".repeat(24), "0"],
      [undefined, undefined],
    ];
    for (const [userId, sessionVersion] of bad) {
      const session = await getSession();
      Object.assign(session, { userId, sessionVersion, role: "user" });
      await session.save();
      await expect(getCurrentUser()).resolves.toBeNull();
    }
  });

  it("ignores a forged role in the cookie: the database role wins", async () => {
    const user = await makeUser("user");
    await signIn({ id: user.id, role: "admin", sessionVersion: user.sessionVersion });
    const current = await getCurrentUser();
    expect(current?.role).toBe("user");
    expect(current?.permissions).not.toContain("user:ban");
  });

  it("gives empty permissions when the Role document is missing (fail closed)", async () => {
    const user = await makeUser("user");
    await signIn(user);
    await mongoose.connection.db!.collection("roles").deleteMany({});
    invalidateRoleCache();
    const current = await getCurrentUser();
    expect(current).not.toBeNull();
    expect(current?.permissions).toEqual([]);
  });

  it("ignores permission strings the server does not know", async () => {
    const user = await makeUser("user");
    await signIn(user);
    await mongoose.connection.db!
      .collection("roles")
      .updateOne({ name: "user" }, { $set: { permissions: ["compile", "root:everything"] } });
    invalidateRoleCache();
    expect((await getCurrentUser())?.permissions).toEqual(["compile"]);
  });
});

describe("requireUser / requireRole", () => {
  it("requireUser throws the 401 fallback error when anonymous", async () => {
    await expect(requireUser()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;401" });
  });

  it("requireUser returns the user when signed in", async () => {
    const user = await makeUser();
    await signIn(user);
    await expect(requireUser()).resolves.toMatchObject({ id: user.id });
  });

  it("requireRole throws 401 when anonymous and 403 (with an audit row) for the wrong role", async () => {
    await expect(requireRole("admin")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;401" });

    const user = await makeUser("user");
    await signIn(user);
    await expect(requireRole("admin")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;403" });
    await auditLogger.flush();
    const rows = await auditRepository.listRecent({ event: "rbac.denied", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: user.id, details: { role: "admin" } });
  });

  it("requireRole passes for the matching role", async () => {
    const admin = await makeUser("admin");
    await signIn(admin);
    await expect(requireRole("admin")).resolves.toMatchObject({ role: "admin" });
  });
});

describe("authorize", () => {
  it("is 401 for an anonymous caller, and writes no audit row", async () => {
    expect(await authorize("compile")).toEqual({ ok: false, status: 401 });
    await auditLogger.flush();
    expect(await auditRepository.listRecent({ event: "rbac.denied", limit: 10 })).toHaveLength(0);
  });

  it("is 403 for a user lacking the permission, with exactly one rbac.denied audit row", async () => {
    const user = await makeUser("user");
    await signIn(user);
    expect(await authorize("user:ban")).toEqual({ ok: false, status: 403 });
    await auditLogger.flush();
    const rows = await auditRepository.listRecent({ event: "rbac.denied", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: user.id, severity: "warn", details: { permission: "user:ban" } });
    expect(rows[0]?.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is ok for an admin, and returns the user DTO", async () => {
    const admin = await makeUser("admin");
    await signIn(admin);
    const result = await authorize("user:ban");
    expect(result.ok).toBe(true);
    expect(result.ok && result.user.id).toBe(admin.id);
    await auditLogger.flush();
    expect(await auditRepository.listRecent({ event: "rbac.denied", limit: 10 })).toHaveLength(0);
  });

  it("denies a user whose Role document has been emptied (fail closed)", async () => {
    const user = await makeUser("user");
    await signIn(user);
    await mongoose.connection.db!.collection("roles").deleteMany({});
    invalidateRoleCache();
    expect(await authorize("compile")).toEqual({ ok: false, status: 403 });
  });
});
