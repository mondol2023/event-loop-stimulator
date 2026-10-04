import "server-only";
import { ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { ensureIndexes } from "@/server/db/indexes";
import { roleRepository } from "@/server/repositories/roleRepository";
import type { RoleName } from "@/server/repositories/types";
import { userRepository } from "@/server/repositories/userRepository";

export type SeedResult = { rolesUpserted: number; promotedAdmin: boolean };

const ROLE_NAMES = Object.keys(ROLE_PERMISSIONS) as RoleName[];

/**
 * Idempotent bootstrap: upserts the Role documents from ROLE_PERMISSIONS, builds
 * indexes, and promotes `adminEmail` to admin if (and only if) that user already
 * exists. It never creates users: letting an unverified registration claim an
 * admin address would hand out admin to whoever registers it first.
 * An existing admin is left alone, so re-running does not invalidate their sessions.
 * The caller must already be connected (see connectDb).
 */
export async function seed(opts: { adminEmail?: string } = {}): Promise<SeedResult> {
  await ensureIndexes();
  await roleRepository.upsertAll(ROLE_NAMES.map((name) => ({ name, permissions: ROLE_PERMISSIONS[name] })));

  let promotedAdmin = false;
  if (opts.adminEmail !== undefined) {
    const user = await userRepository.findByEmail(opts.adminEmail);
    if (user !== null && user.role !== "admin") {
      promotedAdmin = (await userRepository.setRole(user.id, "admin")) !== null;
    }
  }
  return { rolesUpserted: ROLE_NAMES.length, promotedAdmin };
}
