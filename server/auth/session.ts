import "server-only";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/server/auth/sessionCookie";
import { getEnv } from "@/server/env";
import type { RoleName } from "@/server/repositories/types";

/**
 * What the sealed cookie carries. Only `userId` and `sessionVersion` are
 * authoritative: `role` is a display hint, and authorization always re-reads
 * the user (see dal.ts).
 */
export type SessionData = { userId: string; role: RoleName; sessionVersion: number };

const isProduction = process.env.NODE_ENV === "production";

export { SESSION_COOKIE_NAME };

/** Seven days. Revocation does not rely on expiry: it relies on `sessionVersion`. */
const SESSION_TTL_SECONDS = 604_800;

export function sessionOptions(): SessionOptions {
  return {
    cookieName: SESSION_COOKIE_NAME,
    password: getEnv().SESSION_SECRET,
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/" },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}
