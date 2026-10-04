import "server-only";
import type { RoleName } from "@/server/repositories/types";

/** Every capability the server can check. The RBAC matrix below is the single source of truth. */
export const PERMISSIONS = [
  "compile",
  "snippet:create",
  "snippet:update_own",
  "snippet:delete_own",
  "snippet:share",
  "snippet:fork",
  "snippet:moderate",
  "user:list",
  "user:ban",
  "user:role",
  "audit:read",
  "metrics:read",
  "ratelimit:configure",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const USER_PERMISSIONS = [
  "compile",
  "snippet:create",
  "snippet:update_own",
  "snippet:delete_own",
  "snippet:share",
  "snippet:fork",
] as const satisfies readonly Permission[];

export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  user: USER_PERMISSIONS,
  admin: PERMISSIONS,
};

/** What a caller without a session may do. */
export const ANON_PERMISSIONS: readonly Permission[] = ["compile"];

export function can(granted: readonly Permission[], needed: Permission): boolean {
  return granted.includes(needed);
}
