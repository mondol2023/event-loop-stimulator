import "server-only";
import type { ClientSession } from "mongoose";
import { sessionOption } from "./session";
import { parseUserId, type UserId } from "@/core/shared/ids";
import { User } from "@/server/db/models/User";
import type { RoleName, UserRecord, UserStatus } from "./types";

type UserLean = {
  _id: { toString(): string };
  email: string;
  passwordHash: string;
  displayName: string;
  role: RoleName;
  status: UserStatus;
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date | null;
};

function toUserRecord(doc: UserLean): UserRecord {
  return {
    id: doc._id.toString() as UserId,
    email: doc.email,
    passwordHash: doc.passwordHash,
    displayName: doc.displayName,
    role: doc.role,
    status: doc.status,
    sessionVersion: doc.sessionVersion,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastLoginAt: doc.lastLoginAt ?? null,
  };
}

const orNull = (doc: UserLean | null): UserRecord | null => (doc === null ? null : toUserRecord(doc));

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export type CreateUserResult = { ok: true; user: UserRecord } | { ok: false; reason: "email_taken" };

// Update casting does not apply schema enums, so writes are checked here.
const ROLES: readonly RoleName[] = ["user", "admin"];
const STATUSES: readonly UserStatus[] = ["active", "banned"];

function assertWritable(fields: Partial<Pick<UserRecord, "status" | "role" | "passwordHash">>): void {
  if (fields.role !== undefined && !ROLES.includes(fields.role)) throw new TypeError("Unknown user role");
  if (fields.status !== undefined && !STATUSES.includes(fields.status)) throw new TypeError("Unknown user status");
  if (fields.passwordHash !== undefined && (typeof fields.passwordHash !== "string" || fields.passwordHash === "")) {
    throw new TypeError("passwordHash must be a non-empty string");
  }
}

/** Sets `fields` and `$inc`s sessionVersion, which invalidates the user's existing sessions. */
async function bumpSession(
  id: UserId,
  fields: Partial<Pick<UserRecord, "status" | "role" | "passwordHash">>,
  session?: ClientSession,
): Promise<UserRecord | null> {
  assertWritable(fields);
  if (parseUserId(id) === null) return null;
  const doc = await User.findOneAndUpdate(
    { _id: id },
    { $set: fields, $inc: { sessionVersion: 1 } },
    { returnDocument: "after", ...sessionOption(session) },
  ).lean<UserLean>();
  return orNull(doc);
}

// Every filter value is validated to be a string of the right shape before it
// reaches a query, on top of the global `sanitizeFilter` option: an object such
// as `{ $ne: null }` can never become an operator.
export const userRepository = {
  async create(
    input: { email: string; passwordHash: string; displayName: string; role?: RoleName },
    session?: ClientSession,
  ): Promise<CreateUserResult> {
    try {
      const [doc] = await User.create([input], sessionOption(session));
      if (doc === undefined) throw new Error("User.create returned no document");
      return { ok: true, user: toUserRecord(doc.toObject() as unknown as UserLean) };
    } catch (error) {
      if (isDuplicateKey(error)) return { ok: false, reason: "email_taken" };
      throw error;
    }
  },

  async findById(id: UserId, session?: ClientSession): Promise<UserRecord | null> {
    if (parseUserId(id) === null) return null;
    return orNull(await User.findById(id).session(session ?? null).lean<UserLean>());
  },

  async findByEmail(email: string, session?: ClientSession): Promise<UserRecord | null> {
    if (typeof email !== "string") return null;
    const doc = await User.findOne({ email: email.trim().toLowerCase() })
      .session(session ?? null)
      .lean<UserLean>();
    return orNull(doc);
  },

  async recordLogin(id: UserId, at: Date, session?: ClientSession): Promise<void> {
    if (parseUserId(id) === null) return;
    await User.updateOne({ _id: id }, { $set: { lastLoginAt: at } }, sessionOption(session));
  },

  setStatus(id: UserId, status: UserStatus, session?: ClientSession): Promise<UserRecord | null> {
    return bumpSession(id, { status }, session);
  },

  setRole(id: UserId, role: RoleName, session?: ClientSession): Promise<UserRecord | null> {
    return bumpSession(id, { role }, session);
  },

  setPasswordHash(id: UserId, passwordHash: string, session?: ClientSession): Promise<UserRecord | null> {
    return bumpSession(id, { passwordHash }, session);
  },

  async countActiveByRole(role: RoleName, session?: ClientSession): Promise<number> {
    return User.countDocuments({ role, status: "active" }).session(session ?? null);
  },
};
