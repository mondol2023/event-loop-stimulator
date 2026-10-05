import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeRequest, type FakeRequest } from "./helpers/fakeNext";
import { startTestDb } from "./helpers/db";

vi.mock("@/server/env", () => ({
  getEnv: () => ({ SESSION_SECRET: "s".repeat(48), MONGODB_URI: "mongodb://localhost/test" }),
}));

// Lets one test swap in a pool that runs a hanging worker; otherwise the real default pool (stub worker) is used.
const poolOverride = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/security/sandbox/pool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/security/sandbox/pool")>();
  return {
    ...actual,
    getSandboxPool: () => (poolOverride.current ?? actual.getSandboxPool()) as ReturnType<typeof actual.getSandboxPool>,
  };
});

import { POST } from "@/app/api/compile/route";
import { auditLogger } from "@/server/audit/AuditLogger";
import { register } from "@/server/auth/authService";
import { invalidateRoleCache } from "@/server/auth/dal";
import { seed } from "@/server/db/seed";
import { auditRepository } from "@/server/repositories/auditRepository";
import { settingRepository } from "@/server/repositories/settingRepository";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/server/security/csrf";
import { rateLimiter } from "@/server/security/rateLimit/rateLimiter";
import { getRequestContext } from "@/server/security/requestContext";
import { SandboxPool } from "@/server/security/sandbox/pool";
import { MAX_BODY_BYTES } from "@/server/validation/compile";

type TestDb = Awaited<ReturnType<typeof startTestDb>>;
let db: TestDb;
let req: FakeRequest;

beforeAll(async () => {
  db = await startTestDb();
}, 120_000);

afterAll(async () => {
  await db.stop();
}, 60_000);

let ipCounter = 0;
let ip = "";
const freshIp = () => {
  ipCounter += 1;
  return `172.16.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
};

beforeEach(async () => {
  await auditLogger.flush();
  await db.reset();
  await seed();
  invalidateRoleCache();
  rateLimiter.invalidateLimits();
  poolOverride.current = null;
  req = installFakeRequest();
  ip = freshIp();
  req.setIp(ip);
});

const URL_ = "http://localhost:3100/api/compile";

type Opts = {
  body?: BodyInit | null;
  origin?: string | null;
  csrf?: boolean;
  headers?: Record<string, string>;
  duplex?: boolean;
};

/** A well-formed POST: matching Origin and a valid signed CSRF cookie/header pair. */
function post(body: unknown, opts: Opts = {}): Request {
  const token = issueCsrfToken();
  const headers = new Headers({ host: "localhost:3100", "x-forwarded-for": ip, "content-type": "application/json" });
  if (opts.origin !== null) headers.set("origin", opts.origin ?? "http://localhost:3100");
  if (opts.csrf !== false) {
    headers.set("cookie", `${CSRF_COOKIE}=${token}`);
    headers.set(CSRF_HEADER, token);
  }
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k, v);
  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    headers,
    body: opts.body !== undefined ? opts.body : JSON.stringify(body),
  };
  if (opts.duplex) init.duplex = "half";
  return new Request(URL_, init);
}

const rows = async (event: string) => {
  await auditLogger.flush();
  return auditRepository.listRecent({ event, limit: 50 });
};

const setLimits = async (value: unknown) => {
  await settingRepository.set("rateLimits", value);
  rateLimiter.invalidateLimits();
};

describe("happy path", () => {
  it("answers 200 with the stub body and no-store", async () => {
    const response = await POST(post({ code: "console.log(1)", lang: "js" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { stub: boolean; diagnostics: unknown[] };
    expect(body.stub).toBe(true);
    expect(body.diagnostics).toEqual([]);
  });

  it("accepts the largest valid program even when JSON escaping doubles its size", async () => {
    // 10,240 bytes of newlines: every one is escaped to two bytes on the wire.
    const response = await POST(post({ code: "\n".repeat(10_240), lang: "ts" }));
    expect(response.status).toBe(200);
  });
});

describe("ASCII-escaped JSON", () => {
  it("accepts a within-limit program serialized with unicode escapes (about 3x its UTF-8 size)", async () => {
    // 5,120 two-byte characters = 10,240 bytes, but 30,720 bytes on the wire as six-byte escapes.
    const wire = `{"code":"${"\\u00e9".repeat(5120)}","lang":"js"}`;
    expect(wire.length).toBeGreaterThan(30_000);
    const response = await POST(post(null, { body: wire }));
    expect(response.status).toBe(200);
  });
});

describe("rate limiting", () => {
  it("answers 429 with an integer Retry-After once the bucket is empty, and audits it", async () => {
    await setLimits({ "compile.anon": { limit: 2, windowSec: 60 } });
    expect((await POST(post({ code: "1", lang: "js" }))).status).toBe(200);
    expect((await POST(post({ code: "1", lang: "js" }))).status).toBe(200);
    const limited = await POST(post({ code: "1", lang: "js" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^[1-9]\d*$/);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    const hits = await rows("ratelimit.hit");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.details).toMatchObject({ scope: "compile.anon" });
  });

  it("draws a signed-in user from compile.user, not from the anonymous bucket", async () => {
    await setLimits({ "compile.anon": { limit: 1, windowSec: 60 }, "compile.user": { limit: 3, windowSec: 60 } });
    const registered = await register(
      { email: `rl-${ipCounter}@example.com`, password: "correct horse battery staple", displayName: "RL" },
      await getRequestContext(),
    );
    expect(registered.ok).toBe(true);

    for (let i = 0; i < 3; i += 1) expect((await POST(post({ code: "1", lang: "js" }))).status).toBe(200);
    expect((await POST(post({ code: "1", lang: "js" }))).status).toBe(429);
    const hits = await rows("ratelimit.hit");
    expect(hits[0]?.details).toMatchObject({ scope: "compile.user" });
    expect(hits[0]?.actorId).toBeTruthy();

    // Signed out, the same address is still on its own (untouched) anonymous bucket.
    req.cookies.clear();
    expect((await POST(post({ code: "1", lang: "js" }))).status).toBe(200);
    expect((await POST(post({ code: "1", lang: "js" }))).status).toBe(429);
  });

  it("does not spend a token on a request that fails the CSRF or Origin check", async () => {
    await setLimits({ "compile.anon": { limit: 2, windowSec: 60 } });
    for (let i = 0; i < 5; i += 1) {
      expect((await POST(post({ code: "1", lang: "js" }, { csrf: false }))).status).toBe(403);
      expect((await POST(post({ code: "1", lang: "js" }, { origin: "https://evil.example" }))).status).toBe(403);
      expect((await POST(post({ code: "1", lang: "js" }, { origin: null }))).status).toBe(403);
    }
    expect((await POST(post({ code: "1", lang: "js" }))).status).toBe(200);
    expect((await POST(post({ code: "1", lang: "js" }))).status).toBe(200);
    expect((await POST(post({ code: "1", lang: "js" }))).status).toBe(429);
    expect((await rows("csrf.rejected")).length).toBe(15);
  });
});

describe("invalid bodies", () => {
  const cases: [string, unknown][] = [
    ["NUL", { code: "marker_nul\u0000_xyz", lang: "js" }],
    ["a control character", { code: "marker_bel\u0007_xyz", lang: "js" }],
    ["10,241 bytes", { code: "a".repeat(10_241), lang: "js" }],
    // Fewer than 10,240 characters but more than 10,240 bytes: the cap is on bytes.
    ["3-byte characters over the byte cap", { code: "€".repeat(3500), lang: "js" }],
    ["an unknown extra key", { code: "marker_xyz_extra", lang: "js", extra: true }],
    ["an unsupported lang", { code: "marker_xyz_lang", lang: "py" }],
    ["code as an object", { code: { $ne: null }, lang: "js" }],
  ];

  it.each(cases)("rejects %s with 400 and logs a code hash, never the code", async (_name, body) => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    const rejected = await rows("compile.rejected");
    expect(rejected).toHaveLength(1);
    const code = (body as { code?: unknown }).code;
    if (typeof code === "string") {
      expect(rejected[0]?.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(rejected)).not.toContain(code.slice(0, 40).replace(/[\u0000-\u001f]/g, ""));
    }
  });

  it("accepts exactly 10,240 bytes (the boundary) and counts bytes, not characters", async () => {
    expect((await POST(post({ code: "a".repeat(10_240), lang: "js" }))).status).toBe(200);
    // 3413 x 3 bytes + 1 = 10,240 bytes in 3,414 characters.
    expect((await POST(post({ code: "€".repeat(3413) + "a", lang: "js" }))).status).toBe(200);
    expect((await POST(post({ code: "€".repeat(3413) + "ab", lang: "js" }))).status).toBe(400);
  });

  it("rejects malformed JSON with 400", async () => {
    expect((await POST(post(null, { body: "{nope" }))).status).toBe(400);
    expect((await POST(post(null, { body: "" }))).status).toBe(400);
  });
});

describe("oversized or chunked bodies", () => {
  /** A body of `total` bytes in `chunk`-byte pieces that records how much the consumer pulled. */
  function countingBody(total: number, chunk: number) {
    const state = { pulled: 0 };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (state.pulled >= total) {
          controller.close();
          return;
        }
        state.pulled += chunk;
        controller.enqueue(new Uint8Array(chunk).fill(0x61));
      },
    });
    return { state, stream };
  }

  it("answers 413 for a streamed 1 MB body with no Content-Length, and stops reading early", async () => {
    const chunk = 1024;
    const { state, stream } = countingBody(1024 * 1024, chunk);
    const response = await POST(post(null, { body: stream, duplex: true }));
    expect(response.status).toBe(413);
    expect(state.pulled).toBeLessThan(MAX_BODY_BYTES + 8 * chunk);
  });

  it("answers 413 when Content-Length lies (10) about a 1 MB body", async () => {
    const chunk = 1024;
    const { state, stream } = countingBody(1024 * 1024, chunk);
    const response = await POST(post(null, { body: stream, duplex: true, headers: { "content-length": "10" } }));
    expect(response.status).toBe(413);
    expect(state.pulled).toBeLessThan(MAX_BODY_BYTES + 8 * chunk);
  });

  it("answers 413 straight away when Content-Length honestly exceeds the cap", async () => {
    const response = await POST(post(null, { body: "x".repeat(MAX_BODY_BYTES + 1) }));
    expect(response.status).toBe(413);
    const rejected = await rows("compile.rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.codeHash).toBeUndefined();
  });
});

describe("sandbox failures", () => {
  it("answers 503 and audits sandbox.timeout when the worker never answers", async () => {
    const hanging = new SandboxPool({
      workerPath: fileURLToPath(new URL("../fixtures/sandbox/loop-forever.mjs", import.meta.url)),
      size: 1,
      timeoutMs: 200,
    });
    poolOverride.current = hanging;
    try {
      const response = await POST(post({ code: "while(true){}", lang: "js" }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "sandbox_timeout" });
      const timeouts = await rows("sandbox.timeout");
      expect(timeouts).toHaveLength(1);
      expect(timeouts[0]?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await hanging.close();
    }
  });

  it("answers 503 when the pool is saturated", async () => {
    const hanging = new SandboxPool({
      workerPath: fileURLToPath(new URL("../fixtures/sandbox/loop-forever.mjs", import.meta.url)),
      size: 1,
      maxQueue: 0,
      timeoutMs: 1000,
    });
    poolOverride.current = hanging;
    try {
      const first = POST(post({ code: "1", lang: "js" }));
      const second = await POST(post({ code: "1", lang: "js" }));
      expect(second.status).toBe(503);
      expect(await second.json()).toEqual({ error: "sandbox_busy" });
      await first;
    } finally {
      await hanging.close();
    }
  });
});

describe("degraded infrastructure", () => {
  it("still answers when the audit sink and the limits store are failing", async () => {
    // A rejecting `load` is covered in the limits-provider unit test; here the whole request path
    // must survive a broken settings read and a broken audit write at once.
    const settings = await import("@/server/repositories/settingRepository");
    const audits = await import("@/server/repositories/auditRepository");
    const getSpy = vi.spyOn(settings.settingRepository, "get").mockRejectedValue(new Error("mongo down"));
    const insertSpy = vi.spyOn(audits.auditRepository, "insertMany").mockRejectedValue(new Error("mongo down"));
    rateLimiter.invalidateLimits();
    try {
      const response = await POST(post({ code: "1", lang: "js" }));
      expect(response.status).toBe(200);
      await auditLogger.flush();
    } finally {
      getSpy.mockRestore();
      insertSpy.mockRestore();
    }
  });
});
