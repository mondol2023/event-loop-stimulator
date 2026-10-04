import "server-only";
import { forbidden, unauthorized } from "next/navigation";
import { cache } from "react";
import { parseUserId, type UserId } from "@/core/shared/ids";
import { auditLogger } from "@/server/audit/AuditLogger";
import { can, PERMISSIONS, type Permission } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";
import { roleRepository } from "@/server/repositories/roleRepository";
import type { RoleName, UserRecord } from "@/server/repositories/types";
import { userRepository } from "@/server/repositories/userRepository";
import { getRequestContext } from "@/server/security/requestContext";

// The Data Access Layer is where authentication and authorization are
// ENFORCED. `proxy.ts` only does an optimistic cookie check to redirect early;
// it is never the security boundary. Every Server Action, Route Handler and
// protected page goes through the functions below, which re-read the user from
// the database on each request.

/** The only user shape that leaves the DAL. It never carries `passwordHash` or `sessionVersion`. */
export type CurrentUser = {
  id: UserId;
  email: string;
  displayName: string;
  role: RoleName;
  permissions: readonly Permission[];
};

const ROLE_CACHE_TTL_MS = 30_000;
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(PERMISSIONS);

const roleCache = new Map<RoleName, { permissions: readonly Permission[]; expiresAt: number }>();

/** Drops cached role permissions. Call after changing Role documents (tests, seeding). */
export function invalidateRoleCache(): void {
  roleCache.clear();
}

/** Permissions for a role: cached for 30 s; a missing Role document means none (fail closed) and is not cached. */
async function permissionsFor(role: RoleName): Promise<readonly Permission[]> {
  const hit = roleCache.get(role);
  if (hit !== undefined && hit.expiresAt > Date.now()) return hit.permissions;
  const doc = await roleRepository.findByName(role);
  if (doc === null) return [];
  // Only strings this server knows are honored, so a stray DB value grants nothing.
  const permissions = doc.permissions.filter((p): p is Permission => KNOWN_PERMISSIONS.has(p));
  roleCache.set(role, { permissions, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  return permissions;
}

/** Projects a stored user into the DTO (role permissions included). Never exposes the hash or sessionVersion. */
export async function toCurrentUser(user: UserRecord): Promise<CurrentUser> {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    permissions: await permissionsFor(user.role),
  };
}

/**
 * The signed-in user, or `null`. Null covers every failure the same way (no
 * cookie, tampered cookie, malformed claims, unknown or non-active user, stale
 * sessionVersion), so a caller cannot tell which one it was. The cookie only
 * identifies the user; status, role and permissions always come from the database.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  const userId = parseUserId(session.userId);
  if (userId === null || typeof session.sessionVersion !== "number") return null;

  const user = await userRepository.findById(userId);
  if (user === null || user.status !== "active" || user.sessionVersion !== session.sessionVersion) return null;

  return toCurrentUser(user);
});

/** Records a denied access attempt. Auditing never decides or delays the denial: failures are swallowed. */
async function auditDenied(user: CurrentUser, details: { permission: Permission } | { role: RoleName }): Promise<void> {
  try {
    const { requestId, ipHash } = await getRequestContext();
    auditLogger.log({ event: "rbac.denied", severity: "warn", actorId: user.id, ipHash, requestId, details });
  } catch {
    // Intentionally ignored: the caller still returns 403.
  }
}

/** For pages and Server Actions that need a signed-in user. Anonymous callers get the 401 interrupt. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user === null) unauthorized();
  return user;
}

/**
 * Requires EXACTLY `role`: there is no hierarchy, so an admin does NOT satisfy
 * `requireRole("user")`. Prefer `authorize(permission)` for capability checks.
 * 401 when anonymous; 403 plus an `rbac.denied` audit row otherwise.
 */
export async function requireRole(role: RoleName): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== role) {
    await auditDenied(user, { role });
    forbidden();
  }
  return user;
}

export type AuthorizeResult = { ok: true; user: CurrentUser } | { ok: false; status: 401 | 403 };

/**
 * Non-throwing check for Route Handlers and Server Actions that return a
 * status. 401 means "sign in"; 403 means "signed in, not allowed" and is audited.
 */
export async function authorize(permission: Permission): Promise<AuthorizeResult> {
  const user = await getCurrentUser();
  if (user === null) return { ok: false, status: 401 };
  if (!can(user.permissions, permission)) {
    await auditDenied(user, { permission });
    return { ok: false, status: 403 };
  }
  return { ok: true, user };
}
