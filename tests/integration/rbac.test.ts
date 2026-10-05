import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeRequest, type FakeRequest } from "./helpers/fakeNext";
import { startTestDb } from "./helpers/db";

vi.mock("@/server/env", () => ({
  getEnv: () => ({ SESSION_SECRET: "s".repeat(48), MONGODB_URI: "mongodb://localhost/test" }),
}));

import type { UserId } from "@/core/shared/ids";
import { banUserAction, changeUserRoleAction } from "@/server/actions/admin";
import { auditLogger } from "@/server/audit/AuditLogger";
import { login } from "@/server/auth/authService";
import { getCurrentUser, invalidateRoleCache, toCurrentUser, type CurrentUser } from "@/server/auth/dal";
import { hashPassword } from "@/server/auth/password";
import { banUser, changeUserRole } from "@/server/auth/userAdmin";
import { seed } from "@/server/db/seed";
import { auditRepository } from "@/server/repositories/auditRepository";
import type { RoleName } from "@/server/repositories/types";
import { userRepository } from "@/server/repositories/userRepository";
import { getRequestContext } from "@/server/security/requestContext";

type TestDb = Awaited<ReturnType<typeof startTestDb>>;
let db: TestDb;
let req: FakeRequest;
let passwordHash: string;

const PASSWORD = "correct horse battery staple";

beforeAll(async () => {
  db = await startTestDb();
  passwordHash = await hashPassword(PASSWORD);
}, 120_000);

afterAll(async () => {
  await db.stop();
}, 60_000);

let counter = 0;
let ipCounter = 0;
const freshIp = () => {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 250)}.${ipCounter % 250}.9`;
};

beforeEach(async () => {
  await auditLogger.flush();
  await db.reset();
  await seed();
  invalidateRoleCache();
  req = installFakeRequest();
  req.setIp(freshIp());
});

async function makeUser(role: RoleName, tag: string): Promise<CurrentUser> {
  counter += 1;
  const created = await userRepository.create({
    email: `${tag}-${counter}@example.com`,
    passwordHash,
    displayName: tag,
    role,
  });
  if (!created.ok) throw new Error("setup: create failed");
  return toCurrentUser(created.user);
}

/** Signs `user` in on the current fake cookie jar. */
async function signIn(user: CurrentUser): Promise<void> {
  const result = await login({ email: user.email, password: PASSWORD }, await getRequestContext());
  if (!result.ok) throw new Error(`setup: login failed (${result.code})`);
}

/** Runs `fn` with `jar` as the cookie jar and writes any changes back, so one test can hold several browsers. */
async function inBrowser<T>(jar: Map<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = new Map(req.cookies);
  req.cookies.clear();
  for (const [k, v] of jar) req.cookies.set(k, v);
  try {
    return await fn();
  } finally {
    jar.clear();
    for (const [k, v] of req.cookies) jar.set(k, v);
    req.cookies.clear();
    for (const [k, v] of saved) req.cookies.set(k, v);
  }
}

async function auditRows(event: string) {
  await auditLogger.flush();
  return auditRepository.listRecent({ event, limit: 50 });
}

const reload = async (id: UserId) => {
  const user = await userRepository.findById(id);
  if (user === null) throw new Error("setup: user vanished");
  return user;
};

describe("403 and 401 on admin actions", () => {
  it("returns 403 to a plain user, changes nothing, and audits rbac.denied once", async () => {
    const actor = await makeUser("user", "plain");
    const target = await makeUser("user", "target");
    await signIn(actor);

    expect(await banUserAction({ userId: target.id })).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(await changeUserRoleAction({ userId: target.id, role: "admin" })).toMatchObject({ ok: false, status: 403 });

    const after = await reload(target.id);
    expect(after.status).toBe("active");
    expect(after.role).toBe("user");
    expect(after.sessionVersion).toBe(0);
    const denied = await auditRows("rbac.denied");
    expect(denied.filter((row) => row.details?.["permission"] === "user:ban")).toHaveLength(1);
  });

  it("returns 401 to an anonymous caller", async () => {
    const target = await makeUser("user", "target");
    expect(await banUserAction({ userId: target.id })).toMatchObject({ ok: false, status: 401 });
    expect(await changeUserRoleAction({ userId: target.id, role: "admin" })).toMatchObject({ ok: false, status: 401 });
    expect((await reload(target.id)).status).toBe("active");
  });
});

describe("operator injection", () => {
  it("rejects an operator object as the user id with 400 and changes no user", async () => {
    const admin = await makeUser("admin", "root");
    const bystander = await makeUser("user", "bystander");
    await signIn(admin);

    expect(await banUserAction({ userId: { $ne: null } })).toMatchObject({ ok: false, status: 400 });
    expect(await changeUserRoleAction({ userId: { $ne: null }, role: "admin" })).toMatchObject({ ok: false, status: 400 });
    expect(await banUserAction({ userId: bystander.id, extra: true })).toMatchObject({ ok: false, status: 400 });
    expect(await changeUserRoleAction({ userId: bystander.id, role: "superuser" })).toMatchObject({ ok: false, status: 400 });
    expect(await banUserAction("nonsense")).toMatchObject({ ok: false, status: 400 });

    const after = await reload(bystander.id);
    expect(after).toMatchObject({ status: "active", role: "user", sessionVersion: 0 });
    expect((await reload(admin.id)).sessionVersion).toBe(0);
  });
});

describe("ban and role change", () => {
  it("bans a user: status, sessionVersion, revoked session, audit row with the actor", async () => {
    const admin = await makeUser("admin", "root");
    const target = await makeUser("user", "victim");
    const targetJar = new Map<string, string>();
    await inBrowser(targetJar, () => signIn(target));
    expect(await inBrowser(targetJar, () => getCurrentUser())).not.toBeNull();
    await signIn(admin);

    expect(await banUserAction({ userId: target.id })).toEqual({ ok: true });

    const after = await reload(target.id);
    expect(after.status).toBe("banned");
    expect(after.sessionVersion).toBe(1);
    expect(await inBrowser(targetJar, () => getCurrentUser())).toBeNull();

    const rows = await auditRows("user.banned");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: admin.id, details: { from: "active", to: "banned", target: target.id } });
  });

  it("changes a role and audits user.role_changed with from and to", async () => {
    const admin = await makeUser("admin", "root");
    const target = await makeUser("user", "promoted");
    await signIn(admin);

    expect(await changeUserRoleAction({ userId: target.id, role: "admin" })).toEqual({ ok: true });

    const after = await reload(target.id);
    expect(after.role).toBe("admin");
    expect(after.sessionVersion).toBe(1);
    const rows = await auditRows("user.role_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: admin.id, details: { from: "user", to: "admin", target: target.id } });
  });

  it("returns 404 for an id that matches no user, and 400 only for a malformed one", async () => {
    const admin = await makeUser("admin", "root");
    await signIn(admin);
    expect(await banUserAction({ userId: "0".repeat(24) })).toMatchObject({ ok: false, status: 404 });
    expect(await changeUserRoleAction({ userId: "f".repeat(24), role: "user" })).toMatchObject({ ok: false, status: 404 });
    expect(await banUserAction({ userId: "0".repeat(23) })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("not self", () => {
  it("refuses to ban or demote yourself (409 self) and leaves the account untouched", async () => {
    const admin = await makeUser("admin", "root");
    await makeUser("admin", "second");
    await signIn(admin);

    expect(await banUserAction({ userId: admin.id })).toEqual({ ok: false, status: 409, code: "self" });
    expect(await changeUserRoleAction({ userId: admin.id, role: "user" })).toEqual({ ok: false, status: 409, code: "self" });
    // The same id in a different letter case is still the same account.
    expect(await banUserAction({ userId: admin.id.toUpperCase() })).toEqual({ ok: false, status: 409, code: "self" });

    expect(await reload(admin.id)).toMatchObject({ status: "active", role: "admin", sessionVersion: 0 });
    expect(await getCurrentUser()).not.toBeNull();
  });
});

describe("last admin", () => {
  it("rolls the write back when the only admin would be demoted or banned", async () => {
    const onlyAdmin = await makeUser("admin", "only");
    // A caller who is not an admin reaches the service directly (defence in depth).
    const outsider = await makeUser("user", "outsider");
    const ctx = await getRequestContext();
    const before = await reload(onlyAdmin.id);

    expect(await changeUserRole(outsider, onlyAdmin.id, "user", ctx)).toEqual({ ok: false, code: "last_admin" });
    expect(await banUser(outsider, onlyAdmin.id, ctx)).toEqual({ ok: false, code: "last_admin" });

    const after = await reload(onlyAdmin.id);
    expect(after.role).toBe("admin");
    expect(after.status).toBe("active");
    expect(after.sessionVersion).toBe(before.sessionVersion);
    expect(await userRepository.countActiveByRole("admin")).toBe(1);
    expect(await auditRows("user.role_changed")).toHaveLength(0);
    expect(await auditRows("user.banned")).toHaveLength(0);
  });

  it("keeps at least one active admin when two admins demote or ban each other at once", async () => {
    const ctx = await getRequestContext();
    for (let round = 0; round < 5; round += 1) {
      await db.reset();
      await seed();
      invalidateRoleCache();
      const a = await makeUser("admin", `a${round}`);
      const b = await makeUser("admin", `b${round}`);

      const results = await Promise.all(
        round % 2 === 0
          ? [changeUserRole(a, b.id, "user", ctx), changeUserRole(b, a.id, "user", ctx)]
          : [banUser(a, b.id, ctx), banUser(b, a.id, ctx)],
      );

      // Which request wins is not asserted; the invariant is.
      expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(1);
      expect(await userRepository.countActiveByRole("admin")).toBeGreaterThanOrEqual(1);
    }
  });

  it("refuses a stale actor who was demoted after the request was authorized", async () => {
    const ctx = await getRequestContext();
    const a = await makeUser("admin", "a");
    const b = await makeUser("admin", "b");
    const c = await makeUser("admin", "c");

    expect(await changeUserRole(a, b.id, "user", ctx)).toEqual({ ok: true });
    // `b` still holds a DTO from before the demotion; other admins remain, so only the actor check can stop it.
    expect(await changeUserRole(b, c.id, "user", ctx)).toEqual({ ok: false, code: "forbidden" });

    expect(await reload(c.id)).toMatchObject({ role: "admin", sessionVersion: 0 });
    const rows = await auditRows("user.role_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: a.id });
  });
});
