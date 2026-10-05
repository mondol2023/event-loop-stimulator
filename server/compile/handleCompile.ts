import "server-only";
import type { UserId } from "@/core/shared/ids";
import { auditLogger, hashCode, type AuditEntry } from "@/server/audit/AuditLogger";
import { getCurrentUser, type CurrentUser } from "@/server/auth/dal";
import { rateLimiter } from "@/server/security/rateLimit/rateLimiter";
import type { RequestContext } from "@/server/security/requestContext";
import { guardMutation, jsonError } from "@/server/security/routeGuard";
import { getSandboxPool } from "@/server/security/sandbox/pool";
import { CompileInput, MAX_BODY_BYTES, readBoundedJson } from "@/server/validation/compile";

const SLOW_MS = 500;

/** The caller, or `null`. A failing session lookup (database down) is treated as anonymous: it must not take compile down. */
async function currentUserOrNull(): Promise<CurrentUser | null> {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}

/**
 * POST /api/compile, in this order: origin + CSRF -> caller -> rate limit ->
 * bounded body -> validation -> sandbox pool. Each stage can only reject, so a
 * request that fails an early stage never costs a later one (a forged request
 * spends no rate-limit token, an oversized one is never parsed).
 */
export async function handleCompile(request: Request): Promise<Response> {
  const guard = await guardMutation(request);
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  const user = await currentUserOrNull();
  const log = (entry: Omit<AuditEntry, "ipHash" | "requestId" | "actorId">): void =>
    auditLogger.log({ ...entry, ipHash: ctx.ipHash, requestId: ctx.requestId, ...(user === null ? {} : { actorId: user.id }) });

  const limited = await enforceRateLimit(user?.id ?? null, ctx, log);
  if (limited !== null) return limited;

  const body = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!body.ok) {
    log({
      event: "compile.rejected",
      severity: "warn",
      details: { reason: body.status === 413 ? "body_too_large" : "bad_json" },
    });
    return jsonError(body.status, body.status === 413 ? "payload_too_large" : "invalid_request");
  }

  const parsed = CompileInput.safeParse(body.value);
  if (!parsed.success) {
    const code = typeof body.value === "object" && body.value !== null ? (body.value as { code?: unknown }).code : undefined;
    log({
      event: "compile.rejected",
      severity: "warn",
      details: { reason: "invalid_input" },
      ...(typeof code === "string" ? { codeHash: hashCode(code) } : {}),
    });
    return jsonError(400, "invalid_request");
  }

  const { code, lang } = parsed.data;
  const codeHash = hashCode(code);
  const result = await getSandboxPool().run({ code, lang });

  switch (result.status) {
    case "ok":
      if (result.ms > SLOW_MS) log({ event: "compile.slow", severity: "info", codeHash, details: { ms: result.ms } });
      return Response.json({ stub: true, diagnostics: [] }, { headers: { "Cache-Control": "no-store" } });
    case "timeout":
      log({ event: "sandbox.timeout", severity: "warn", codeHash });
      return jsonError(503, "sandbox_timeout");
    case "crashed":
      log({ event: "sandbox.timeout", severity: "warn", codeHash, details: { reason: result.reason } });
      return jsonError(503, "sandbox_unavailable");
    case "busy":
      return jsonError(503, "sandbox_busy", { "Retry-After": "1" });
  }
}

/**
 * Consumes one token: per user when signed in, else per hashed IP. Fails CLOSED
 * (503) if the limiter itself cannot answer, as a store outage must not switch
 * the limit off. Settings-store trouble never reaches here: the limits provider
 * falls back to the defaults.
 */
async function enforceRateLimit(
  userId: UserId | null,
  ctx: RequestContext,
  log: (entry: Omit<AuditEntry, "ipHash" | "requestId" | "actorId">) => void,
): Promise<Response | null> {
  const scope = userId === null ? "compile.anon" : "compile.user";
  try {
    const verdict = await rateLimiter.check(scope, userId ?? ctx.ipHash);
    if (verdict.allowed) return null;
    log({ event: "ratelimit.hit", severity: "warn", details: { scope } });
    return jsonError(429, "rate_limited", { "Retry-After": String(Math.max(1, Math.ceil(verdict.retryAfterSec))) });
  } catch {
    log({ event: "ratelimit.hit", severity: "warn", details: { scope, reason: "store_error" } });
    return jsonError(503, "rate_limit_unavailable", { "Retry-After": "1" });
  }
}
