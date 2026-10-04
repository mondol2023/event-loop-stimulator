import "server-only";
import { createHash } from "node:crypto";
import { parseUserId, type UserId } from "@/core/shared/ids";
import { auditLogger, withAudit } from "@/server/audit/AuditLogger";
import { toCurrentUser, type CurrentUser } from "@/server/auth/dal";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/server/auth/password";
import { getSession } from "@/server/auth/session";
import type { UserRecord } from "@/server/repositories/types";
import { userRepository } from "@/server/repositories/userRepository";
import { rateLimiter } from "@/server/security/rateLimit/rateLimiter";
import type { RequestContext } from "@/server/security/requestContext";
import type { ChangePasswordInput, LoginInput, RegisterInput } from "@/server/validation/auth";

export type AuthResult =
  | { ok: true; user: CurrentUser }
  | {
      ok: false;
      code: "invalid_credentials" | "email_taken" | "rate_limited" | "invalid_current_password";
      retryAfterSec?: number;
    };

type Failure = Extract<AuthResult, { ok: false }>;

// Unknown email, wrong password and a banned account all return exactly this
// object, so neither the result nor its timing says which one it was. The
// audit row (`details.reason`) is the only place the difference is recorded.
const INVALID_CREDENTIALS: Failure = { ok: false, code: "invalid_credentials" };

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
const sha256hex = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * Consumes one `auth` token for this client + account. Fails CLOSED: if the
 * limiter cannot answer (store outage), the request is denied rather than
 * allowed, since an outage must not switch off brute-force protection.
 * Runs before any database lookup or password work.
 */
async function enforceRateLimit(
  action: "register" | "login" | "change_password",
  email: string,
  ctx: RequestContext,
  actorId?: UserId,
): Promise<Failure | null> {
  let verdict: { allowed: boolean; retryAfterSec: number } | null;
  try {
    verdict = await rateLimiter.check("auth", `${ctx.ipHash}:${sha256hex(normalizeEmail(email))}`);
  } catch {
    // Deliberately nothing from the error: it may carry connection strings.
    verdict = null;
  }
  if (verdict?.allowed === true) return null;

  auditLogger.log({
    event: "ratelimit.hit",
    severity: "warn",
    ...(actorId === undefined ? {} : { actorId }),
    ipHash: ctx.ipHash,
    requestId: ctx.requestId,
    details: { scope: "auth", action, ...(verdict === null ? { reason: "store_error" } : {}) },
  });
  const retryAfterSec = verdict?.retryAfterSec;
  return retryAfterSec !== undefined && retryAfterSec > 0
    ? { ok: false, code: "rate_limited", retryAfterSec }
    : { ok: false, code: "rate_limited" };
}

/**
 * Session regeneration: whatever the cookie held is destroyed, then a session
 * is built only from the database row (never from request input). iron-session
 * is stateless, so this is what guarantees a pre-login cookie cannot be reused.
 */
async function issueSession(user: UserRecord): Promise<void> {
  (await getSession()).destroy();
  // iron-session refuses to save into a destroyed session object, so write into a fresh one.
  const session = await getSession();
  session.userId = user.id;
  session.role = user.role;
  session.sessionVersion = user.sessionVersion;
  await session.save();
}

function logLoginFailed(ctx: RequestContext, reason: "unknown_email" | "bad_password" | "banned", actorId?: UserId): void {
  auditLogger.log({
    event: "auth.login_failed",
    severity: "warn",
    ...(actorId === undefined ? {} : { actorId }),
    ipHash: ctx.ipHash,
    requestId: ctx.requestId,
    details: { reason },
  });
}

/** `outcome` plus, for a refusal, why: derived from what the wrapped call returned or threw. */
function authDetails(o: { result?: AuthResult; error?: unknown }): Record<string, string> {
  if (o.error !== undefined || o.result === undefined) return { outcome: "error" };
  return o.result.ok ? { outcome: "success" } : { outcome: "error", reason: o.result.code };
}

const actorOf = (o: { result?: AuthResult }): UserId | undefined => (o.result?.ok ? o.result.user.id : undefined);

async function registerImpl(input: RegisterInput, ctx: RequestContext): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const limited = await enforceRateLimit("register", email, ctx);
  if (limited) return limited;

  const passwordHash = await hashPassword(input.password);
  // The unique email index is the only guard that holds under concurrency: two
  // simultaneous registrations both get here and exactly one insert wins.
  const created = await userRepository.create({ email, passwordHash, displayName: input.displayName });
  if (!created.ok) return { ok: false, code: "email_taken" };

  await issueSession(created.user);
  return { ok: true, user: await toCurrentUser(created.user) };
}

export const register: (input: RegisterInput, ctx: RequestContext) => Promise<AuthResult> = withAudit(registerImpl, {
  event: "auth.register",
  actor: actorOf,
  details: authDetails,
});

/**
 * Login outcomes are audited directly (not through `withAudit`) because the
 * failure reason (`unknown_email|bad_password|banned`) must be on the row.
 */
export async function login(input: LoginInput, ctx: RequestContext): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const limited = await enforceRateLimit("login", email, ctx);
  if (limited) return limited;

  const user = await userRepository.findByEmail(email);
  if (user === null) {
    await verifyAgainstDummy(input.password);
    logLoginFailed(ctx, "unknown_email");
    return INVALID_CREDENTIALS;
  }

  // Verified before the status check so a banned account costs the same as a
  // wrong password and timing does not reveal the ban.
  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (user.status !== "active") {
    logLoginFailed(ctx, "banned", user.id);
    return INVALID_CREDENTIALS;
  }
  if (!passwordOk) {
    logLoginFailed(ctx, "bad_password", user.id);
    return INVALID_CREDENTIALS;
  }

  await issueSession(user);
  await userRepository.recordLogin(user.id, new Date());
  auditLogger.log({ event: "auth.login", severity: "info", actorId: user.id, ipHash: ctx.ipHash, requestId: ctx.requestId });
  return { ok: true, user: await toCurrentUser(user) };
}

async function logoutImpl(): Promise<{ actorId?: UserId }> {
  const session = await getSession();
  // Only a sealed, well-formed id is attributed; anything else is just anonymous.
  const actorId = parseUserId(session.userId) ?? undefined;
  session.destroy();
  return actorId === undefined ? {} : { actorId };
}

const auditedLogout = withAudit(logoutImpl, {
  event: "auth.logout",
  actor: ({ result }) => result?.actorId,
  details: ({ error }) => ({ outcome: error === undefined ? "success" : "error" }),
});

/** `ctx` is accepted for symmetry with the other entry points; `withAudit` resolves the request context itself. */
export async function logout(ctx: RequestContext): Promise<void> {
  void ctx;
  await auditedLogout();
}

async function changePasswordImpl(user: CurrentUser, input: ChangePasswordInput, ctx: RequestContext): Promise<AuthResult> {
  const limited = await enforceRateLimit("change_password", user.email, ctx, user.id);
  if (limited) return limited;

  const record = await userRepository.findById(user.id);
  if (record === null || record.status !== "active") {
    await verifyAgainstDummy(input.currentPassword);
    return { ok: false, code: "invalid_current_password" };
  }
  if (!(await verifyPassword(record.passwordHash, input.currentPassword))) {
    return { ok: false, code: "invalid_current_password" };
  }

  // Bumps sessionVersion, which revokes every session that exists right now...
  const updated = await userRepository.setPasswordHash(user.id, await hashPassword(input.newPassword));
  if (updated === null) return { ok: false, code: "invalid_current_password" };
  // ...so the caller is re-issued one carrying the NEW version and stays signed in.
  await issueSession(updated);
  return { ok: true, user: await toCurrentUser(updated) };
}

export const changePassword: (user: CurrentUser, input: ChangePasswordInput, ctx: RequestContext) => Promise<AuthResult> =
  withAudit(changePasswordImpl, {
    event: "auth.password_changed",
    actor: ({ args }) => args[0].id,
    details: authDetails,
  });
