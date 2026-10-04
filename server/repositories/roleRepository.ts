import "server-only";
import type { ClientSession } from "mongoose";
import { Role } from "@/server/db/models/Role";
import type { RoleName, RoleRecord } from "./types";

export const roleRepository = {
  async upsertAll(roles: readonly RoleRecord[], session?: ClientSession): Promise<void> {
    if (roles.length === 0) return;
    await Role.bulkWrite(
      roles.map((role) => ({
        updateOne: {
          filter: { name: role.name },
          update: { $set: { permissions: [...role.permissions] } },
          upsert: true,
        },
      })),
      { session },
    );
  },

  async findByName(name: RoleName, session?: ClientSession): Promise<RoleRecord | null> {
    if (typeof name !== "string") return null;
    const doc = await Role.findOne({ name })
      .session(session ?? null)
      .lean<{ name: RoleName; permissions: string[] }>();
    return doc === null ? null : { name: doc.name, permissions: [...doc.permissions] };
  },
};
