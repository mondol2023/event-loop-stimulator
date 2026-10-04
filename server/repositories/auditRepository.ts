import "server-only";
import type { ClientSession } from "mongoose";
import { sessionOption } from "./session";
import { parseUserId, type UserId } from "@/core/shared/ids";
import { AuditLog } from "@/server/db/models/AuditLog";
import type { AuditRecord, AuditSeverity } from "./types";

type AuditLean = {
  at: Date;
  actorId?: { toString(): string };
  ipHash: string;
  requestId: string;
  event: string;
  severity: AuditSeverity;
  details?: Record<string, string | number | boolean | null>;
  codeHash?: string;
};

export type StoredAuditRecord = AuditRecord & { at: Date };

function toAuditRecord(doc: AuditLean): StoredAuditRecord {
  return {
    event: doc.event,
    severity: doc.severity,
    ipHash: doc.ipHash,
    requestId: doc.requestId,
    at: doc.at,
    ...(doc.actorId === undefined ? {} : { actorId: doc.actorId.toString() as UserId }),
    ...(doc.details === undefined ? {} : { details: doc.details }),
    ...(doc.codeHash === undefined ? {} : { codeHash: doc.codeHash }),
  };
}

export const auditRepository = {
  async insertMany(entries: readonly AuditRecord[], session?: ClientSession): Promise<void> {
    if (entries.length === 0) return;
    for (const entry of entries) {
      if (entry.actorId !== undefined && parseUserId(entry.actorId) === null) {
        throw new TypeError("Audit actorId must be a valid user id");
      }
    }
    await AuditLog.insertMany(
      entries.map((entry) => ({ ...entry })),
      sessionOption(session),
    );
  },

  async listRecent(query: { event?: string; limit: number }, session?: ClientSession): Promise<StoredAuditRecord[]> {
    const filter: { event?: string } = {};
    if (query.event !== undefined) {
      if (typeof query.event !== "string") return [];
      filter.event = query.event;
    }
    const docs = await AuditLog.find(filter)
      .sort({ at: -1 })
      .limit(query.limit)
      .session(session ?? null)
      .lean<AuditLean[]>();
    return docs.map(toAuditRecord);
  },
};
