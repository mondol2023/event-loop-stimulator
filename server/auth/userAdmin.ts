import "server-only";
import type { ClientSession } from "mongoose";
import type { UserId } from "@/core/shared/ids";
import { auditLogger, type AuditDetails, type AuditEvent } from "@/server/audit/AuditLogger";
import type { CurrentUser } from "@/server/auth/dal";
import { inTransaction } from "@/server/db/transaction";
import type { RoleName, UserRecord } from "@/server/repositories/types";
import { userRepository } from "@/server/repositories/userRepository";
import type { RequestContext } from "@/server/security/requestContext";

export type AdminResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "self" | "last_admin" | "forbidden" };

type Refusal = Extract<AdminResult, { ok: false }>["code"];

/** Thrown inside the transaction so everything written so far is rolled back. */
class AdminRuleError extends Error {
  constructor(readonly code: Refusal) {
    super(code);
  }
}

type Change = {
  event: Extract<AuditEvent, "user.banned" | "user.role_changed">;
  write: (targetId: UserId, session: ClientSession) => Promise<UserRecord | null>;
  details: (before: UserRecord) => AuditDetails;
};

/**
 * Applies one privileged change to another account. The write bumps the
 * target's sessionVersion (revoking its sessions). Inside the same transaction:
 *
 * - the actor's row is touched first. Two admins demoting each other write
 *   different rows, so without a shared row both transactions would commit on
 *   their own snapshot and leave zero admins (write skew). Touching the actor
 *   makes such transactions conflict, and the loser retries on fresh state;
 * - at least one active admin must remain, else everything rolls back;
 * - the actor must STILL be an active admin: the DTO was read before the
 *   transaction, and a demotion or ban in between must not keep working.
 *
 * Audit rows are written only after the commit.
 */
async function applyChange(actor: CurrentUser, targetId: UserId, ctx: RequestContext, change: Change): Promise<AdminResult> {
  // Ids are 24-hex strings and hex is case-insensitive: compare the canonical form.
  if (actor.id.toLowerCase() === targetId.toLowerCase()) return { ok: false, code: "self" };

  let before: UserRecord;
  try {
    before = await inTransaction(async (session) => {
      await userRepository.touch(actor.id, session);
      const target = await userRepository.findById(targetId, session);
      if (target === null) throw new AdminRuleError("not_found");
      if ((await change.write(targetId, session)) === null) throw new AdminRuleError("not_found");

      if ((await userRepository.countActiveByRole("admin", session)) < 1) throw new AdminRuleError("last_admin");
      const actorNow = await userRepository.findById(actor.id, session);
      if (actorNow === null || actorNow.status !== "active" || actorNow.role !== "admin") {
        throw new AdminRuleError("forbidden");
      }
      return target;
    });
  } catch (error) {
    if (error instanceof AdminRuleError) return { ok: false, code: error.code };
    throw error;
  }

  auditLogger.log({
    event: change.event,
    severity: "warn",
    actorId: actor.id,
    ipHash: ctx.ipHash,
    requestId: ctx.requestId,
    details: { ...change.details(before), target: targetId },
  });
  return { ok: true };
}

export function banUser(actor: CurrentUser, targetId: UserId, ctx: RequestContext): Promise<AdminResult> {
  return applyChange(actor, targetId, ctx, {
    event: "user.banned",
    write: (id, session) => userRepository.setStatus(id, "banned", session),
    details: (before) => ({ from: before.status, to: "banned" }),
  });
}

export function changeUserRole(
  actor: CurrentUser,
  targetId: UserId,
  role: RoleName,
  ctx: RequestContext,
): Promise<AdminResult> {
  return applyChange(actor, targetId, ctx, {
    event: "user.role_changed",
    write: (id, session) => userRepository.setRole(id, role, session),
    details: (before) => ({ from: before.role, to: role }),
  });
}
