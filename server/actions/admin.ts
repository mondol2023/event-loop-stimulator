"use server";

import "server-only";
import { authorize } from "@/server/auth/dal";
import { banUser, changeUserRole, type AdminResult } from "@/server/auth/userAdmin";
import { getRequestContext } from "@/server/security/requestContext";
import { AdminTargetInput, RoleChangeInput } from "@/server/validation/admin";

// This file may only export async Server Actions, so every helper stays private.
// These return a status instead of calling forbidden(): callers (and tests) see an
// HTTP-like result, and pages decide what to render.

export type AdminActionResult = { ok: true } | { ok: false; status: 400 | 401 | 403 | 404 | 409; code: string };

const STATUS: Record<Extract<AdminResult, { ok: false }>["code"], 403 | 404 | 409> = {
  forbidden: 403,
  not_found: 404,
  self: 409,
  last_admin: 409,
};

function toActionResult(result: AdminResult): AdminActionResult {
  return result.ok ? { ok: true } : { ok: false, status: STATUS[result.code], code: result.code };
}

export async function banUserAction(input: unknown): Promise<AdminActionResult> {
  const auth = await authorize("user:ban");
  if (!auth.ok) return { ok: false, status: auth.status, code: auth.status === 401 ? "unauthorized" : "forbidden" };

  const parsed = AdminTargetInput.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, code: "invalid_input" };

  return toActionResult(await banUser(auth.user, parsed.data.userId, await getRequestContext()));
}

export async function changeUserRoleAction(input: unknown): Promise<AdminActionResult> {
  const auth = await authorize("user:role");
  if (!auth.ok) return { ok: false, status: auth.status, code: auth.status === 401 ? "unauthorized" : "forbidden" };

  const parsed = RoleChangeInput.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, code: "invalid_input" };

  return toActionResult(
    await changeUserRole(auth.user, parsed.data.userId, parsed.data.role, await getRequestContext()),
  );
}
