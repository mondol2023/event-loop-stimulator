import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { installFakeRequest, type FakeRequest } from "./helpers/fakeNext";
import { startTestDb } from "./helpers/db";

vi.mock("@/server/env", () => ({
  getEnv: () => ({ SESSION_SECRET: "s".repeat(48), MONGODB_URI: "mongodb://localhost/test" }),
}));

// Real implementation, wrapped in a spy so tests can see whether it ran.
vi.mock("@/server/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/password")>();
  return { ...actual, verifyAgainstDummy: vi.fn(actual.verifyAgainstDummy) };
});

import { loginAction, logoutAction, registerAction, changePasswordAction } from "@/server/actions/auth";
import { auditLogger } from "@/server/audit/AuditLogger";
import { changePassword, login, logout, register } from "@/server/auth/authService";
import { getCurrentUser, invalidateRoleCache } from "@/server/auth/dal";
import { verifyAgainstDummy } from "@/server/auth/password";
import { seed } from "@/server/db/seed";
import { auditRepository } from "@/server/repositories/auditRepository";
import { userRepository } from "@/server/repositories/userRepository";
import { rateLimiter } from "@/server/security/rateLimit/rateLimiter";
import { getRequestContext } from "@/server/security/requestContext";
import type { CurrentUser } from "@/server/auth/dal";

type TestDb = Awaited<ReturnType<typeof startTestDb>>;
let db: TestDb;
let req: FakeRequest;

beforeAll(async () => {
  db = await startTestDb();
}, 120_000);

afterAll(async () => {
  await db.stop();
}, 60_000);

// The default rate limiter is a process-wide memory store that outlives each
// test, so every test gets its own IP and its own emails.
let counter = 0;
const unique = () => ++counter;

let ipCounter = 0;
/** A never-reused address, so the process-wide limiter never carries over between tests. */
const freshIp = () => {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 250)}.${ipCounter % 250}.7`;
};

beforeEach(async () => {
  // Rows queued by the previous test must land (and then be wiped) before this one starts.
  await auditLogger.flush();
  await db.reset();
  await seed();
  invalidateRoleCache();
  vi.mocked(verifyAgainstDummy).mockClear();
  req = installFakeRequest();
  req.setIp(freshIp());
});

const PASSWORD = "correct horse battery staple";
const OTHER_PASSWORD = "another long passphrase 42";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest;
    throw error;
  }
  throw new Error("expected the action to redirect");
}

const uniqueEmail = (tag: string) => `${tag}-${unique()}@example.com`;

async function signUp(email = uniqueEmail("user"), password = PASSWORD): Promise<CurrentUser> {
  const result = await register({ email, password, displayName: "Tester" }, await getRequestContext());
  if (!result.ok) throw new Error(`setup: register failed (${result.code})`);
  return result.user;
}

/** Runs `fn` with `jar` as the cookie jar, and writes any changes back, so one test can hold several browsers. */
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

const rawUsers = () => mongoose.connection.db!.collection("users");

describe("register and login through the Server Actions", () => {
  it("registers, signs in, stores an argon2id hash, and logs back in", async () => {
    const email = uniqueEmail("alice");
    const redirected = await redirectOf(
      registerAction({ ok: false }, form({ email, password: PASSWORD, displayName: "Alice" })),
    );
    expect(redirected).toContain("/playground");

    const current = await getCurrentUser();
    expect(current).toMatchObject({ email, displayName: "Alice", role: "user" });

    const stored = await userRepository.findByEmail(email);
    expect(stored?.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(stored?.passwordHash).not.toContain(PASSWORD);

    req.cookies.clear();
    expect(await getCurrentUser()).toBeNull();
    const loggedIn = await redirectOf(loginAction({ ok: false }, form({ email, password: PASSWORD })));
    expect(loggedIn).toContain("/playground");
    expect((await getCurrentUser())?.email).toBe(email);
    expect((await userRepository.findByEmail(email))?.lastLoginAt).toBeInstanceOf(Date);
  });

  it("ignores unknown form fields such as role, and a registered user is never an admin", async () => {
    const email = uniqueEmail("sneaky");
    await redirectOf(
      registerAction(
        { ok: false },
        form({ email, password: PASSWORD, displayName: "Sneaky", role: "admin", status: "active", $ACTION_ID_x: "1" }),
      ),
    );
    expect((await getCurrentUser())?.role).toBe("user");
    expect((await userRepository.findByEmail(email))?.role).toBe("user");
  });

  it("returns field errors for invalid input and never echoes the password", async () => {
    const state = await registerAction({ ok: false }, form({ email: "not-an-email", password: "short", displayName: "" }));
    expect(state.ok).toBe(false);
    expect(Object.keys(state.fieldErrors ?? {}).sort()).toEqual(["displayName", "email", "password"]);
    expect(JSON.stringify(state)).not.toContain("short");
    expect(await userRepository.findByEmail("not-an-email")).toBeNull();
  });

  it("treats an operator-like email as invalid input, not a query", async () => {
    const data = form({ password: PASSWORD });
    data.set("email", JSON.stringify({ $ne: null }));
    const state = await loginAction({ ok: false }, data);
    expect(state.ok).toBe(false);
    expect(state.fieldErrors).toHaveProperty("email");
  });

  it("rejects a taken email on the register action without more detail than that", async () => {
    const email = uniqueEmail("dup");
    await signUp(email);
    req.cookies.clear();
    const state = await registerAction({ ok: false }, form({ email, password: PASSWORD, displayName: "Again" }));
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/already/i);
    expect(state.fieldErrors).toBeUndefined();
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("generic login failure", () => {
  it("is identical for wrong password, unknown email and a banned user, while the audit reasons differ", async () => {
    const real = await signUp();
    const banned = await signUp();
    await userRepository.setStatus(banned.id, "banned");
    req.cookies.clear();

    const wrongPassword = await loginAction({ ok: false }, form({ email: real.email, password: "definitely-wrong-pw" }));
    const unknownEmail = await loginAction({ ok: false }, form({ email: uniqueEmail("ghost"), password: PASSWORD }));
    const bannedUser = await loginAction({ ok: false }, form({ email: banned.email, password: PASSWORD }));

    expect(wrongPassword.ok).toBe(false);
    expect(wrongPassword.message).toBeTruthy();
    expect(unknownEmail).toEqual(wrongPassword);
    expect(bannedUser).toEqual(wrongPassword);
    expect(await getCurrentUser()).toBeNull();

    const rows = await auditRows("auth.login_failed");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.details?.["reason"]).sort()).toEqual(["bad_password", "banned", "unknown_email"]);
    expect(rows.every((r) => r.severity === "warn")).toBe(true);
  });

  it("returns the same service result code for all three and never leaks status", async () => {
    const real = await signUp();
    const banned = await signUp();
    await userRepository.setStatus(banned.id, "banned");
    const ctx = await getRequestContext();
    const results = [
      await login({ email: real.email, password: "definitely-wrong-pw" }, ctx),
      await login({ email: uniqueEmail("ghost"), password: PASSWORD }, ctx),
      await login({ email: banned.email, password: PASSWORD }, ctx),
    ];
    for (const result of results) expect(result).toEqual({ ok: false, code: "invalid_credentials" });
  });

  it("calls the dummy verifier for an unknown email and not for a known one", async () => {
    const real = await signUp();
    const ctx = await getRequestContext();
    vi.mocked(verifyAgainstDummy).mockClear();
    await login({ email: uniqueEmail("ghost"), password: PASSWORD }, ctx);
    expect(verifyAgainstDummy).toHaveBeenCalledTimes(1);
    vi.mocked(verifyAgainstDummy).mockClear();
    await login({ email: real.email, password: "definitely-wrong-pw" }, ctx);
    expect(verifyAgainstDummy).not.toHaveBeenCalled();
  });

  it("rejects a banned user with the correct password, and their existing session stops resolving", async () => {
    const user = await signUp();
    expect((await getCurrentUser())?.id).toBe(user.id);
    await userRepository.setStatus(user.id, "banned");
    expect(await getCurrentUser()).toBeNull();

    req.cookies.clear();
    const result = await login({ email: user.email, password: PASSWORD }, await getRequestContext());
    expect(result).toEqual({ ok: false, code: "invalid_credentials" });
    expect(await getCurrentUser()).toBeNull();
  });

  it("does not leave a signed-in session behind after a failed login", async () => {
    const first = await signUp();
    const ctx = await getRequestContext();
    await login({ email: first.email, password: "definitely-wrong-pw" }, ctx);
    // The existing session is untouched by a failed attempt for the same account.
    expect((await getCurrentUser())?.id).toBe(first.id);
  });
});

describe("session handling", () => {
  it("sets the session from the database row, replacing whatever the cookie held", async () => {
    const a = await signUp();
    const b = await signUp();
    // Browser is signed in as `a`; logging in as `b` must replace, not merge.
    const result = await login({ email: b.email, password: PASSWORD }, await getRequestContext());
    expect(result.ok).toBe(true);
    expect((await getCurrentUser())?.id).toBe(b.id);
    expect((await getCurrentUser())?.id).not.toBe(a.id);
  });

  it("logout destroys the session and writes an audit row", async () => {
    const user = await signUp();
    await redirectOf(logoutAction());
    expect(await getCurrentUser()).toBeNull();
    const rows = await auditRows("auth.logout");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(user.id);
  });

  it("logout is safe when nobody is signed in", async () => {
    await expect(logout(await getRequestContext())).resolves.toBeUndefined();
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("changePassword", () => {
  it("revokes every other session and keeps the caller signed in", async () => {
    const email = uniqueEmail("rev");
    await signUp(email);
    const jarA = new Map<string, string>();
    const jarB = new Map<string, string>();
    req.cookies.clear();
    const ctx = await getRequestContext();
    const resultA = await inBrowser(jarA, () => login({ email, password: PASSWORD }, ctx));
    const resultB = await inBrowser(jarB, () => login({ email, password: PASSWORD }, ctx));
    expect(resultA.ok && resultB.ok).toBe(true);
    if (!resultA.ok) throw new Error("unreachable");

    expect(await inBrowser(jarA, () => getCurrentUser())).not.toBeNull();
    expect(await inBrowser(jarB, () => getCurrentUser())).not.toBeNull();

    const changed = await inBrowser(jarA, () =>
      changePassword(resultA.user, { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD }, ctx),
    );
    expect(changed.ok).toBe(true);

    expect(await inBrowser(jarA, () => getCurrentUser())).not.toBeNull();
    expect(await inBrowser(jarB, () => getCurrentUser())).toBeNull();

    // The old password is dead and the new one works (fresh IP: this one has used its tokens).
    req.setIp(freshIp());
    const ctx2 = await getRequestContext();
    expect(await login({ email, password: PASSWORD }, ctx2)).toEqual({ ok: false, code: "invalid_credentials" });
    expect((await login({ email, password: OTHER_PASSWORD }, ctx2)).ok).toBe(true);
  });

  it("rejects a wrong current password without changing anything", async () => {
    const user = await signUp();
    const before = await userRepository.findById(user.id);
    const result = await changePassword(
      user,
      { currentPassword: "not-my-password", newPassword: OTHER_PASSWORD },
      await getRequestContext(),
    );
    expect(result).toEqual({ ok: false, code: "invalid_current_password" });
    const after = await userRepository.findById(user.id);
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.sessionVersion).toBe(before?.sessionVersion);
    expect(await getCurrentUser()).not.toBeNull();
  });

  it("works through the action, with field errors for a weak new password", async () => {
    await signUp();
    const weak = await changePasswordAction({ ok: false }, form({ currentPassword: PASSWORD, newPassword: "short" }));
    expect(weak.ok).toBe(false);
    expect(weak.fieldErrors).toHaveProperty("newPassword");

    const wrong = await changePasswordAction({ ok: false }, form({ currentPassword: "nope-nope-nope", newPassword: OTHER_PASSWORD }));
    expect(wrong.ok).toBe(false);
    expect(JSON.stringify(wrong)).not.toContain(OTHER_PASSWORD);

    const ok = await changePasswordAction({ ok: false }, form({ currentPassword: PASSWORD, newPassword: OTHER_PASSWORD }));
    expect(ok.ok).toBe(true);
    expect(await getCurrentUser()).not.toBeNull();
  });

  it("requires a signed-in user", async () => {
    const state = await changePasswordAction({ ok: false }, form({ currentPassword: PASSWORD, newPassword: OTHER_PASSWORD }));
    expect(state.ok).toBe(false);
  });
});

describe("rate limiting", () => {
  it("blocks the 6th attempt for the same IP+email even with the right password, but not another IP", async () => {
    const email = uniqueEmail("limited");
    await signUp(email);
    req.cookies.clear();
    req.setIp(freshIp());
    const ctx = await getRequestContext();

    for (let i = 0; i < 5; i += 1) {
      expect(await login({ email, password: "definitely-wrong-pw" }, ctx)).toEqual({
        ok: false,
        code: "invalid_credentials",
      });
    }
    const sixth = await login({ email, password: PASSWORD }, ctx);
    expect(sixth.ok).toBe(false);
    if (sixth.ok) throw new Error("unreachable");
    expect(sixth.code).toBe("rate_limited");
    expect(sixth.retryAfterSec).toBeGreaterThan(0);
    expect(await getCurrentUser()).toBeNull();
    expect((await auditRows("ratelimit.hit")).length).toBeGreaterThanOrEqual(1);

    req.setIp(freshIp());
    const elsewhere = await login({ email, password: PASSWORD }, await getRequestContext());
    expect(elsewhere.ok).toBe(true);
  });

  it("is checked before any database lookup or password work", async () => {
    const email = uniqueEmail("early");
    const ctx = await getRequestContext();
    for (let i = 0; i < 5; i += 1) await login({ email, password: "definitely-wrong-pw" }, ctx);
    vi.mocked(verifyAgainstDummy).mockClear();
    const lookup = vi.spyOn(userRepository, "findByEmail");
    const result = await login({ email, password: PASSWORD }, ctx);
    expect(result).toMatchObject({ ok: false, code: "rate_limited" });
    expect(lookup).not.toHaveBeenCalled();
    expect(verifyAgainstDummy).not.toHaveBeenCalled();
    lookup.mockRestore();
  });

  it("fails closed when the rate-limit store throws", async () => {
    const real = await signUp();
    req.cookies.clear();
    const check = vi.spyOn(rateLimiter, "check").mockRejectedValue(new Error("redis down"));
    const lookup = vi.spyOn(userRepository, "findByEmail");
    try {
      const result = await login({ email: real.email, password: PASSWORD }, await getRequestContext());
      expect(result).toMatchObject({ ok: false, code: "rate_limited" });
      expect(lookup).not.toHaveBeenCalled();
      expect(await getCurrentUser()).toBeNull();

      const registered = await register(
        { email: uniqueEmail("denied"), password: PASSWORD, displayName: "Nope" },
        await getRequestContext(),
      );
      expect(registered).toMatchObject({ ok: false, code: "rate_limited" });
    } finally {
      check.mockRestore();
      lookup.mockRestore();
    }
  });

  it("normalizes the email in the limiter key so case and spacing do not dodge the limit", async () => {
    const email = uniqueEmail("case");
    const ctx = await getRequestContext();
    for (let i = 0; i < 5; i += 1) await login({ email: ` ${email.toUpperCase()} `, password: "definitely-wrong-pw" }, ctx);
    const result = await login({ email, password: PASSWORD }, ctx);
    expect(result).toMatchObject({ ok: false, code: "rate_limited" });
  });
});

describe("register concurrency (Review Focus 1)", () => {
  it("lets exactly one of two simultaneous registrations for the same email win", async () => {
    const ctx = await getRequestContext();
    const local = `Race-${unique()}`;
    const results = await Promise.all([
      register({ email: `${local}@X.com `, password: PASSWORD, displayName: "A" }, ctx),
      register({ email: `${local.toLowerCase()}@x.com`, password: PASSWORD, displayName: "B" }, ctx),
    ]);
    const oks = results.filter((r) => r.ok);
    const taken = results.filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(taken).toEqual([{ ok: false, code: "email_taken" }]);
    expect(await rawUsers().countDocuments({ email: `${local.toLowerCase()}@x.com` })).toBe(1);
  });
});

describe("audit trail", () => {
  it("records every auth event and none of them contains the password, a hash, or the email", async () => {
    const email = uniqueEmail("audited");
    const ctx = await getRequestContext();
    const registered = await register({ email, password: PASSWORD, displayName: "Audited" }, ctx);
    if (!registered.ok) throw new Error("setup");
    await login({ email, password: "definitely-wrong-pw" }, ctx);
    await login({ email, password: PASSWORD }, ctx);
    await changePassword(registered.user, { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD }, ctx);
    await logout(ctx);
    // Burn the remaining tokens to get a ratelimit.hit row.
    for (let i = 0; i < 4; i += 1) await login({ email, password: "definitely-wrong-pw" }, ctx);

    for (const event of [
      "auth.register",
      "auth.login",
      "auth.login_failed",
      "auth.logout",
      "auth.password_changed",
      "ratelimit.hit",
    ]) {
      expect((await auditRows(event)).length, event).toBeGreaterThanOrEqual(1);
    }

    const stored = await userRepository.findByEmail(email);
    const everything = JSON.stringify(await auditRepository.listRecent({ limit: 200 }));
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain(OTHER_PASSWORD);
    expect(everything).not.toContain("definitely-wrong-pw");
    expect(everything).not.toContain("$argon2");
    expect(everything).not.toContain(stored?.passwordHash ?? "no-hash");
    expect(everything).not.toContain(email);

    const registerRows = await auditRows("auth.register");
    expect(registerRows[0]).toMatchObject({ severity: "info", actorId: registered.user.id, details: { outcome: "success" } });
  });

  it("marks a failed registration with outcome error under the same event", async () => {
    const email = uniqueEmail("taken");
    const ctx = await getRequestContext();
    await register({ email, password: PASSWORD, displayName: "One" }, ctx);
    await register({ email, password: PASSWORD, displayName: "Two" }, ctx);
    const rows = await auditRows("auth.register");
    expect(rows.map((r) => r.details?.["outcome"]).sort()).toEqual(["error", "success"]);
  });
});
