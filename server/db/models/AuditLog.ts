import "server-only";
import "../mongooseConfig";
import { type InferSchemaType, type Model, model, models, Schema } from "mongoose";

/** Audit entries expire after 90 days (PROMPT.md §7.7). */
export const AUDIT_TTL_SECONDS = 90 * 24 * 60 * 60;

const auditLogSchema = new Schema({
  at: { type: Date, required: true, default: () => new Date() },
  actorId: { type: Schema.Types.ObjectId, ref: "User" },
  ipHash: { type: String, required: true },
  requestId: { type: String, required: true },
  event: { type: String, required: true },
  severity: { type: String, required: true },
  details: { type: Schema.Types.Mixed, default: {} },
  codeHash: { type: String },
});

auditLogSchema.index({ at: 1 }, { expireAfterSeconds: AUDIT_TTL_SECONDS });
auditLogSchema.index({ event: 1, at: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;

export const AuditLog = (models["AuditLog"] as Model<AuditLogDoc> | undefined) ?? model<AuditLogDoc>("AuditLog", auditLogSchema);
