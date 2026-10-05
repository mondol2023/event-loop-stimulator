import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/server/env";

export const CSRF_COOKIE = "sl_csrf";
export const CSRF_HEADER = "x-csrf-token";

// Signed double-submit: the token is `<random>.<HMAC(random)>`. A plain
// double-submit cookie can be forged by anything able to set a cookie for this
// site (a sibling subdomain); without the server secret such a pair cannot be
// signed, so it does not verify.

/** Domain-separated, so the raw session secret is never used directly as an HMAC key here. */
function csrfKey(): Buffer {
  return createHmac("sha256", getEnv().SESSION_SECRET).update("silicon-loop:csrf:v1").digest();
}

const sign = (random: string): string => createHmac("sha256", csrfKey()).update(random).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function issueCsrfToken(): string {
  const random = randomBytes(32).toString("base64url");
  return `${random}.${sign(random)}`;
}

/** Both values present, identical, and carrying a signature this server made. */
export function verifyCsrf(cookieValue: string | undefined, headerValue: string | null): boolean {
  if (!cookieValue || !headerValue) return false;
  if (!safeEqual(cookieValue, headerValue)) return false;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return false;
  const [random, signature] = parts as [string, string];
  if (random === "" || signature === "") return false;
  // Compared as the encoded string (not decoded bytes), so the unused padding bits cannot be flipped.
  return safeEqual(signature, sign(random));
}

/**
 * Same rule as Next's Server Action origin check: `Origin` must be present, must
 * not be the opaque `"null"`, and its host (with port) must equal the request's
 * `x-forwarded-host`, else `host`. A missing `Origin` is a failure, not a pass-through.
 */
export function checkOrigin(headers: Headers, requestUrl: string): boolean {
  const origin = headers.get("origin");
  if (origin === null || origin === "" || origin === "null") return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  let expected = forwarded || headers.get("host");
  if (!expected) {
    try {
      expected = new URL(requestUrl).host;
    } catch {
      return false;
    }
  }
  return originHost.toLowerCase() === expected.toLowerCase();
}
