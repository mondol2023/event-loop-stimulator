import "server-only";
import "./mongooseConfig"; // global query hardening; must run before any schema is built
import mongoose from "mongoose";
import { getEnv } from "@/server/env";

type Cache = { promise: Promise<typeof mongoose> | undefined };

// Cached on globalThis so Next's HMR (which re-evaluates modules) reuses one
// connection pool instead of opening a new one per edit.
const globalForDb = globalThis as typeof globalThis & { __siliconLoopMongo?: Cache };
const cache: Cache = (globalForDb.__siliconLoopMongo ??= { promise: undefined });

/**
 * Connects once per process; later calls share the same connection. The URI
 * comes from the environment only when a connection actually has to be opened.
 */
export function connectDb(uri?: string): Promise<typeof mongoose> {
  if (cache.promise === undefined) {
    const attempt = mongoose.connect(uri ?? getEnv().MONGODB_URI, { serverSelectionTimeoutMS: 3000, maxPoolSize: 10 });
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

type AsyncMethods<T> = { [K in keyof T]: (...args: never[]) => Promise<unknown> };

/**
 * Wraps every method of a repository so it opens the connection first. Nothing
 * connects at boot, and an unconnected Mongoose buffers a query for 10 s before
 * failing, so each data-layer call makes sure the (cached) connection exists:
 * the first call connects, a failed connect is retried by the next call, and an
 * outage fails after the 3 s server-selection timeout instead.
 */
export function withConnection<T extends AsyncMethods<T>>(repository: T): T {
  const wrapped: Record<string, unknown> = {};
  for (const [name, method] of Object.entries(repository) as [string, (...args: unknown[]) => Promise<unknown>][]) {
    wrapped[name] = async (...args: unknown[]) => {
      await connectDb();
      return method(...args);
    };
  }
  return wrapped as T;
}
