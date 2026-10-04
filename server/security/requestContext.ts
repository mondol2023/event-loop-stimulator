import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { getEnv } from "@/server/env";

export type RequestContext = { requestId: string; ipHash: string };

/**
 * The client address as seen by our single trusted proxy. That proxy appends
 * the real peer to `x-forwarded-for`, so the LAST entry is trustworthy and the
 * first is whatever the client sent. Falls back to `x-real-ip`, then "unknown".
 */
export function clientIp(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const last = forwarded.split(",").at(-1)?.trim();
    if (last) return last;
  }
  const real = h.get("x-real-ip")?.trim();
  return real || "unknown";
}

let ipHashKey: { secret: string; key: Buffer } | undefined;

// Domain-separated key: the raw session secret is never used directly as an
// HMAC key for IP hashing, so a hash can't be replayed in another context.
function ipKey(): Buffer {
  const secret = getEnv().SESSION_SECRET;
  if (ipHashKey?.secret !== secret) {
    ipHashKey = { secret, key: createHmac("sha256", secret).update("silicon-loop:ip-hash:v1").digest() };
  }
  return ipHashKey.key;
}

/** Hex HMAC-SHA256 of the IP: stable for rate limiting and audit, not reversible to the address. */
export function hashIp(ip: string): string {
  return createHmac("sha256", ipKey()).update(ip).digest("hex");
}

export function requestContextFrom(h: Headers): RequestContext {
  return {
    requestId: h.get("x-request-id") || crypto.randomUUID(),
    ipHash: hashIp(clientIp(h)),
  };
}

export async function getRequestContext(): Promise<RequestContext> {
  return requestContextFrom(await headers());
}
