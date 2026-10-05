import "server-only";
import { withConnection } from "@/server/db/connection";
import type { ClientSession } from "mongoose";
import { sessionOption } from "./session";
import { Setting } from "@/server/db/models/Setting";

export const settingRepository = withConnection({
  async get(key: string, session?: ClientSession): Promise<unknown | null> {
    if (typeof key !== "string") return null;
    const doc = await Setting.findOne({ key })
      .session(session ?? null)
      .lean<{ value?: unknown }>();
    return doc?.value ?? null;
  },

  async set(key: string, value: unknown, session?: ClientSession): Promise<void> {
    if (typeof key !== "string") throw new TypeError("Setting key must be a string");
    await Setting.updateOne({ key }, { $set: { value } }, { upsert: true, ...sessionOption(session) });
  },

  /**
   * Upserts `key` (value `null` when new) and increments its `touches` counter
   * inside `session`. Two concurrent transactions that touch the same key
   * conflict on the write, which Task 8 uses to force write-conflicts.
   */
  async touch(key: string, session?: ClientSession): Promise<void> {
    if (typeof key !== "string") throw new TypeError("Setting key must be a string");
    await Setting.updateOne(
      { key },
      { $inc: { touches: 1 }, $setOnInsert: { value: null } },
      { upsert: true, ...sessionOption(session) },
    );
  },
});
