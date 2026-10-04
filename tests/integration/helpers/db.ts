import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "@/server/db/connection";
import { ensureIndexes } from "@/server/db/indexes";

export type TestDb = {
  readonly uri: string;
  stop(): Promise<void>;
  /** Deletes every document in every collection; indexes are kept. */
  reset(): Promise<void>;
};

/** Starts an in-memory single-node replica set (transactions need one) and connects to it. */
export async function startTestDb(): Promise<TestDb> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await connectDb(uri);
  await ensureIndexes();
  return {
    uri,
    async reset() {
      const collections = await mongoose.connection.db!.collections();
      await Promise.all(collections.map((c) => c.deleteMany({})));
    },
    async stop() {
      await disconnectDb();
      await replSet.stop();
    },
  };
}
