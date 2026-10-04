import "server-only";
import mongoose from "mongoose";
import { getEnv } from "@/server/env";

// Global query hardening (PROMPT.md §7.7): `sanitizeFilter` wraps any `$`
// operator found in a user-supplied filter value in `$eq`, and `strictQuery`
// throws on filter paths that are not in the schema.
mongoose.set("sanitizeFilter", true);
mongoose.set("strictQuery", "throw");

type Cache = { promise: Promise<typeof mongoose> | undefined };

// Cached on globalThis so Next's HMR (which re-evaluates modules) reuses one
// connection pool instead of opening a new one per edit.
const globalForDb = globalThis as typeof globalThis & { __siliconLoopMongo?: Cache };
const cache: Cache = (globalForDb.__siliconLoopMongo ??= { promise: undefined });

/** Connects once per process; later calls share the same connection. */
export function connectDb(uri: string = getEnv().MONGODB_URI): Promise<typeof mongoose> {
  if (cache.promise === undefined) {
    const attempt = mongoose.connect(uri, { serverSelectionTimeoutMS: 3000, maxPoolSize: 10 });
    cache.promise = attempt;
    // A failed connect must not poison the cache: the next call retries.
    attempt.catch(() => {
      if (cache.promise === attempt) cache.promise = undefined;
    });
  }
  return cache.promise;
}

export async function disconnectDb(): Promise<void> {
  const pending = cache.promise;
  cache.promise = undefined;
  if (pending !== undefined) await pending.catch(() => undefined);
  await mongoose.disconnect();
}
