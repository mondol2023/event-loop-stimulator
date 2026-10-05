import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeRequest } from "./helpers/fakeNext";
import { startTestDb } from "./helpers/db";

vi.mock("@/server/env", () => ({
  getEnv: () => ({ SESSION_SECRET: "s".repeat(48), MONGODB_URI: "mongodb://localhost/test" }),
}));

import { GET } from "@/app/api/csrf/route";
import { auditLogger } from "@/server/audit/AuditLogger";
import { auditRepository } from "@/server/repositories/auditRepository";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken, verifyCsrf } from "@/server/security/csrf";
import { guardMutation, jsonError } from "@/server/security/routeGuard";

type TestDb = Awaited<ReturnType<typeof startTestDb>>;
let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
}, 120_000);

afterAll(async () => {
  await db.stop();
}, 60_000);

beforeEach(async () => {
  await auditLogger.flush();
  await db.reset();
  installFakeRequest();
});

const REQUEST_URL = "https://app.example/api/compile";

function post(init: { origin?: string | null; cookie?: string; token?: string | null; extra?: Record<string, string> }): Request {
  const headers = new Headers({ host: "app.example", "x-forwarded-for": "9.9.9.9", ...init.extra });
  if (init.origin !== null) headers.set("origin", init.origin ?? "https://app.example");
  if (init.cookie !== undefined) headers.set("cookie", init.cookie);
  if (init.token !== undefined && init.token !== null) headers.set(CSRF_HEADER, init.token);
  return new Request(REQUEST_URL, { method: "POST", headers, body: "{}" });
}

const rejections = async () => {
  await auditLogger.flush();
  return auditRepository.listRecent({ event: "csrf.rejected", limit: 20 });
};

describe("guardMutation", () => {
  it("passes a matching Origin with a valid cookie/header pair and returns a request context", async () => {
    const token = issueCsrfToken();
    const result = await guardMutation(post({ cookie: `other=1; ${CSRF_COOKIE}=${token}; more=2`, token }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.ipHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.ctx.requestId).toBeTruthy();
    }
    expect(await rejections()).toHaveLength(0);
  });

  it("answers 403 csrf and audits csrf.rejected once for a bad token pair", async () => {
    const result = await guardMutation(post({ cookie: `${CSRF_COOKIE}=${issueCsrfToken()}`, token: issueCsrfToken() }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      expect(await result.response.json()).toEqual({ error: "csrf" });
    }
    const rows = await rejections();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toMatchObject({ reason: "token" });
  });

  it("rejects a missing cookie, a missing header, and no CSRF material at all", async () => {
    const token = issueCsrfToken();
    for (const request of [post({ token }), post({ cookie: `${CSRF_COOKIE}=${token}` }), post({})]) {
      const result = await guardMutation(request);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
  });

  it("rejects a missing Origin, Origin null, a foreign Origin and an X-Forwarded-Host mismatch even with a valid pair", async () => {
    const token = issueCsrfToken();
    const cookie = `${CSRF_COOKIE}=${token}`;
    const attempts = [
      post({ origin: null, cookie, token }),
      post({ origin: "null", cookie, token }),
      post({ origin: "https://evil.example", cookie, token }),
      post({ cookie, token, extra: { "x-forwarded-host": "evil.example" } }),
    ];
    for (const request of attempts) {
      const result = await guardMutation(request);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
    const rows = await rejections();
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.details?.["reason"] === "origin")).toBe(true);
  });

  it("never records the token in the audit row", async () => {
    const token = issueCsrfToken();
    await guardMutation(post({ cookie: `${CSRF_COOKIE}=${token}`, token: issueCsrfToken() }));
    expect(JSON.stringify(await rejections())).not.toContain(token);
  });
});

describe("jsonError", () => {
  it("builds a no-store JSON error and merges extra headers", async () => {
    const response = jsonError(429, "rate_limited", { "Retry-After": "7" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "rate_limited" });
  });
});

describe("GET /api/csrf", () => {
  it("sets the sl_csrf cookie and returns a token that verifies against it", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { token } = (await response.json()) as { token: string };
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${CSRF_COOKIE}=${token}`);
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie.toLowerCase()).not.toContain("httponly");
    expect(setCookie).toContain("Path=/");
    expect(verifyCsrf(token, token)).toBe(true);
  });
});
