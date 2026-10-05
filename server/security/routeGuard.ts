import "server-only";
import { auditLogger } from "@/server/audit/AuditLogger";
import { checkOrigin, CSRF_COOKIE, CSRF_HEADER, verifyCsrf } from "@/server/security/csrf";
import { requestContextFrom, type RequestContext } from "@/server/security/requestContext";

export function jsonError(status: number, error: string, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ error }), { status, headers });
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export type GuardResult = { ok: true; ctx: RequestContext } | { ok: false; response: Response };

/**
 * First gate of every mutating Route Handler: Origin check, then the signed
 * double-submit token. Runs before any rate-limit token is spent or body is read.
 * A failure answers 403 and is audited as `csrf.rejected` (reason only; the token is never recorded).
 */
export async function guardMutation(request: Request): Promise<GuardResult> {
  const ctx = requestContextFrom(request.headers);
  const reject = (reason: "origin" | "token"): GuardResult => {
    auditLogger.log({
      event: "csrf.rejected",
      severity: "warn",
      ipHash: ctx.ipHash,
      requestId: ctx.requestId,
      details: { reason },
    });
    return { ok: false, response: jsonError(403, "csrf") };
  };

  if (!checkOrigin(request.headers, request.url)) return reject("origin");
  if (!verifyCsrf(cookieValue(request.headers.get("cookie"), CSRF_COOKIE), request.headers.get(CSRF_HEADER))) {
    return reject("token");
  }
  return { ok: true, ctx };
}
