import "server-only";
import { parseUserId, type UserId } from "@/core/shared/ids";
import { z } from "@/core/shared/zod";

// `.strict()`, and the id must be a 24-hex string: an operator object such as
// `{ $ne: null }` fails on type here, before any query is built.
const userId = z.string().transform((value, ctx): UserId => {
  const id = parseUserId(value);
  if (id === null) {
    ctx.addIssue({ code: "custom", message: "must be a valid user id" });
    return z.NEVER;
  }
  return id;
});

export const AdminTargetInput = z.object({ userId }).strict();
export type AdminTargetInput = z.infer<typeof AdminTargetInput>;

export const RoleChangeInput = z.object({ userId, role: z.enum(["user", "admin"]) }).strict();
export type RoleChangeInput = z.infer<typeof RoleChangeInput>;
