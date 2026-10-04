import "server-only";
import { AuditLog } from "./models/AuditLog";
import { Role } from "./models/Role";
import { Setting } from "./models/Setting";
import { Snippet } from "./models/Snippet";
import { User } from "./models/User";

/** Builds every declared index (and creates the collections). Call after connecting. */
export async function ensureIndexes(): Promise<void> {
  await Promise.all([User, Role, Snippet, AuditLog, Setting].map((model) => model.init()));
}
