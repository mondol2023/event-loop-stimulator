import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import { connectDb } from "@/server/db/connection";

/**
 * Runs `fn` in a transaction (retrying transient errors, as `withTransaction`
 * does) and returns its result. A thrown error aborts and rolls back. The
 * session is always ended. Requires a replica set.
 */
export async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  await connectDb();
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(fn);
  } finally {
    await session.endSession();
  }
}
