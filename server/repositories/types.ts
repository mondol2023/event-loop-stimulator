import "server-only";
import type { SnippetId, UserId } from "@/core/shared/ids";

// Plain domain types returned by repositories: no Mongoose documents, no
// `_id`/`__v`, ids as branded strings. Nothing outside server/repositories/
// and server/db/ ever sees a model.

export type RoleName = "user" | "admin";
export type UserStatus = "active" | "banned";
export type SnippetVisibility = "private" | "unlisted" | "public";

export type UserRecord = {
  id: UserId;
  email: string;
  passwordHash: string;
  displayName: string;
  role: RoleName;
  status: UserStatus;
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
};

export type RoleRecord = {
  name: RoleName;
  permissions: readonly string[];
};

export type SnippetRecord = {
  id: SnippetId;
  ownerId: UserId;
  title: string;
  source: string;
  lang: string;
  slug: string;
  visibility: SnippetVisibility;
  forkedFrom: SnippetId | null;
  stats: { views: number; forks: number };
  createdAt: Date;
  updatedAt: Date;
};

export type AuditSeverity = "info" | "warn" | "critical";

/** What `auditRepository` stores. Task 5's `AuditEntry` is a structural subtype. */
export type AuditRecord = {
  event: string;
  severity: AuditSeverity;
  actorId?: UserId;
  ipHash: string;
  requestId: string;
  details?: Record<string, string | number | boolean | null>;
  codeHash?: string;
  at?: Date;
};
