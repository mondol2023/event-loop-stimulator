import { expect, test } from "@playwright/test";

// No database is needed: nothing here reaches a code path that must read Mongo.

test("playground is served with a nonce CSP, no unsafe-eval and the hardening headers", async ({ request }) => {
  const response = await request.get("/playground");
  const csp = response.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).toContain("worker-src 'self' blob:");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(response.headers()["x-request-id"]).toBeTruthy();
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});

test("a well-formed incoming x-request-id is kept and a malformed one is replaced", async ({ request }) => {
  const kept = await request.get("/playground", { headers: { "x-request-id": "trace-12345678" } });
  expect(kept.headers()["x-request-id"]).toBe("trace-12345678");
  const replaced = await request.get("/playground", { headers: { "x-request-id": "bad id\twith spaces" } });
  expect(replaced.headers()["x-request-id"]).not.toBe("bad id\twith spaces");
});

test("loading the playground produces no CSP violations", async ({ page }) => {
  const messages: string[] = [];
  page.on("console", (message) => messages.push(message.text()));
  page.on("pageerror", (error) => messages.push(error.message));
  await page.goto("/playground");
  await expect(page.getByRole("heading", { level: 1, name: "Playground" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(messages.filter((text) => /Content Security Policy/i.test(text))).toEqual([]);
});

test("POST /api/compile without an Origin header is refused", async ({ request }) => {
  const response = await request.post("/api/compile", { data: { code: "1", lang: "js" } });
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({ error: "csrf" });
});

test("GET /api/csrf returns a token and sets the cookie", async ({ request }) => {
  const response = await request.get("/api/csrf");
  expect(response.status()).toBe(200);
  const { token } = (await response.json()) as { token: string };
  expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(response.headers()["set-cookie"]).toContain(`sl_csrf=${token}`);
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("/admin without a session cookie redirects to /login", async ({ request }) => {
  const response = await request.get("/admin/users?tab=1", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  // Next emits a relative Location; resolve it against any base to read its parts.
  const location = new URL(response.headers()["location"] ?? "", "http://localhost");
  expect(location.pathname).toBe("/login");
  expect(location.searchParams.get("next")).toBe("/admin/users?tab=1");
  expect(response.headers()["content-security-policy"]).toBeTruthy();
});

test("POST /api/compile answers from the production build (worker pool path resolves)", async ({ request, baseURL }) => {
  const { token } = (await (await request.get("/api/csrf")).json()) as { token: string };
  // Mongo is not running in e2e: the limits provider falls back to its defaults and audit writes are swallowed.
  const response = await request.post("/api/compile", {
    data: { code: "console.log(1)", lang: "js" },
    headers: { origin: baseURL ?? "", "x-csrf-token": token },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ stub: true, diagnostics: [] });
});
