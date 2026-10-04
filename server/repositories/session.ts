import "server-only";
import type { ClientSession } from "mongoose";

/**
 * Mongoose options for an optional session. Under `exactOptionalPropertyTypes`
 * a literal `{ session: undefined }` is not assignable to its option types, so
 * the key is added only when a session was given.
 */
export const sessionOption = (session: ClientSession | undefined): { session?: ClientSession } =>
  session === undefined ? {} : { session };
