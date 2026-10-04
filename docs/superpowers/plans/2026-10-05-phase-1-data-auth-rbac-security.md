# Phase 1 — Data, Auth, RBAC, Security: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the server foundation: MongoDB connection, models and repositories, iron-session + argon2id auth, RBAC, rate limiting, CSRF, CSP/headers, audit logging and a stubbed `/api/compile` behind a `worker_threads` pool.

**Architecture:** Everything lives under `server/` (each file starts with `import "server-only"`) plus a thin `proxy.ts`. Layers: `proxy.ts` (optimistic cookie check + headers) → DAL (`server/auth/dal.ts`, the real authorization point) → services → repositories (the only importers of Mongoose models). Server Actions and Route Handlers are thin: Zod → authorize → rate limit → service → audit.

**Tech Stack:** Next.js 16.3 (`proxy.ts`, async `cookies()`/`headers()`), Mongoose 9, iron-session 9, argon2 0.45, ioredis 6, Zod 4 (via `@/core/shared/zod`), Vitest 5 + `mongodb-memory-server` 11 (`MongoMemoryReplSet`).

**Spec:** `PROMPT.md` §7.7 (server), §5 (stack), §9 Phase 1, §4 (workflow). Read `node_modules/next/dist/docs/01-app/02-guides/{data-security,authentication,content-security-policy}.md` and `03-api-reference/03-file-conventions/proxy.md` before Tasks 6, 10 and 12.

## Global Constraints

- Never execute user code. No `eval`/`new Function`/`vm`/`child_process`/`ShadowRealm`, and `/api/compile` runs a **stub** here; the pool is a resource guard, not a sandbox for user code.
- `server/` files start with `import "server-only"`. A `"use server"` action file puts the directive first, then `import "server-only"`; it may export only async functions (types are fine).
- Zod only via `import { z } from "@/core/shared/zod"`; every boundary schema is `.strict()`. Env only via `getEnv()` (never `process.env` in server code, except `NODE_ENV`).
- Mongoose: `sanitizeFilter: true`, `strictQuery: "throw"` globally; only `server/repositories/**` and `server/db/**` import models; repositories return plain domain types (`.lean()` + map); multi-document writes use `session.withTransaction`; connection cached on `globalThis`.
- Session payload `{ userId, role, sessionVersion }`; argon2id `memoryCost 19456` KiB (19 MiB), `timeCost 2`, `parallelism 1`; generic login error; constant-time comparisons; per-IP+email login limit; regenerate session on login; bump `sessionVersion` on password change, ban, role change.
- Input: code ≤ 10 KB (10,240 bytes), reject NUL and control chars other than `\n\t\r`; validate `slug`/`id` formats before any query.
- Rate limits (token bucket, keyed by `userId`, else hashed IP): compile anon 20/min, compile user 60/min, auth 5/min per IP+email, snippet writes 30/min. 429 with `Retry-After`; every hit audit-logged. Limits live in a Mongo `Setting` doc, 30 s cache.
- CSP: nonce-based, `worker-src 'self' blob:`, **no `'unsafe-eval'` in production**, `frame-ancestors 'none'`; plus `nosniff`, `strict-origin-when-cross-origin`, minimal `Permissions-Policy`.
- Sandbox: `worker_threads` pool, `resourceLimits` 64 MB, 2 s wall-clock timeout.
- Audit: events `auth.*`, `rbac.denied`, `ratelimit.hit`, `compile.rejected`, `compile.slow`, `sandbox.timeout`, `snippet.moderated`, `user.role_changed`, `user.banned`; store `codeHash`, never raw code; fire-and-forget bounded queue; TTL 90 days.
- Commit per task with Conventional Commits; end each message with the `Co-Authored-By` trailer from the session's attribution reminder.

## Review Focus

Inputs the spec implies but its "done when" list doesn't exercise (each has a named test below):

1. **Concurrent duplicate registration** (same email, two requests at once, or `Alice@X.com ` vs `alice@x.com`): exactly one account; the loser gets the normal "email taken" result, never a 500. → Task 7.
2. **Oversized or chunked request body on `/api/compile`** (no/lying `Content-Length`): 413 before JSON parsing; the process never buffers more than the cap. → Task 11.
3. **`Origin` missing, `Origin: null`, or `X-Forwarded-Host` mismatch on a mutating route**: 403, not a pass-through. → Task 10.
4. **Two admins demote/ban each other at once, or the sole admin demotes themselves**: at least one active admin always remains. → Task 8.
5. **Rate-limit store growth and DB outage**: the memory store is bounded (eviction), and when Mongo is unreachable limits fall back to defaults instead of hanging or failing open. → Task 4.

---

## File Structure

```
core/shared/ids.ts                         branded UserId/SnippetId + parsers (pure)
server/db/connection.ts  transaction.ts  indexes.ts  seed.ts
server/db/models/{User,Role,Snippet,AuditLog,Setting}.ts
server/repositories/{types,userRepository,roleRepository,snippetRepository,auditRepository,settingRepository}.ts
server/auth/{permissions,password,session,dal,authService,userAdmin}.ts
server/validation/{auth,admin,compile}.ts
server/security/{requestContext,csrf,headers,routeGuard,taint}.ts
server/security/rateLimit/{store,memoryStore,redisStore,limits,rateLimiter}.ts
server/security/sandbox/{pool.ts,compile-worker.mjs}
server/audit/AuditLogger.ts
server/actions/{auth,admin}.ts
app/api/{csrf,compile}/route.ts            routing only
proxy.ts   scripts/seed.mts
tests/integration/helpers/{db,fakeNext}.ts + *.test.ts (MongoMemoryReplSet)
tests/fixtures/sandbox/{loop-forever,alloc-bomb}.mjs   repo-owned worker fixtures
```

Unit tests that need no database are colocated (`*.test.ts` beside the module), like `server/env.test.ts`.

---

### Task 1: Branded IDs, connection, models, transaction helper

**Files:**
- Create: `core/shared/ids.ts`, `server/db/{connection,transaction,indexes}.ts`, `server/db/models/{User,Role,Snippet,AuditLog,Setting}.ts`
- Create: `tests/integration/helpers/db.ts`, `tests/integration/db.test.ts`, `core/shared/ids.test.ts`

**Interfaces:**
- Produces (`core/shared/ids.ts`): `type UserId`, `type SnippetId` (branded strings); `parseUserId(input: unknown): UserId | null` and `parseSnippetId(input: unknown): SnippetId | null` (24-hex ObjectId strings); `isSlug(input: unknown): input is string` (`/^[A-Za-z0-9_-]{10}$/`).
- Produces (`server/db/connection.ts`): `connectDb(uri?: string): Promise<typeof mongoose>` (defaults to `getEnv().MONGODB_URI`; cached on `globalThis`; options `serverSelectionTimeoutMS: 3000`, `maxPoolSize: 10`; a failed connect clears the cache so the next call retries); `disconnectDb(): Promise<void>`.
- Produces (`server/db/transaction.ts`): `inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T>` over `session.withTransaction`; always ends the session.
- Produces (`server/db/indexes.ts`): `ensureIndexes(): Promise<void>` (awaits `Model.init()` for all five models).
- Produces (tests helper): `startTestDb(): Promise<{ uri: string; stop(): Promise<void>; reset(): Promise<void> }>` — starts `MongoMemoryReplSet.create({ replSet: { count: 1 } })`, calls `connectDb(uri)` + `ensureIndexes()`; `reset()` deletes all documents but keeps indexes.
- Model fields exactly per PROMPT §7.7 (User `status: "active"|"banned"` default `active`, `role: "user"|"admin"`, `sessionVersion` default 0, `lastLoginAt` nullable; Snippet `visibility: "private"|"unlisted"|"public"`, `slug` nanoid(10) unique, `stats: { views, forks }`, index `{ownerId:1, updatedAt:-1}`; AuditLog index `{event:1, at:-1}` and TTL `expireAfterSeconds: 7776000` on `at`; Setting `key` unique, `value: Mixed`; Role `name` unique, `permissions: string[]`). Models are registered with `models.X ?? model(...)` so HMR doesn't recompile them.

- [ ] **Step 1: Write failing tests**
  - `ids.test.ts`: `parseUserId("0".repeat(24))` returns the string; `parseUserId({ $ne: null })`, `parseUserId("x")`, `parseUserId("0".repeat(23))` return `null`; `isSlug("abcdefghij")` true, `isSlug("abc")`/`isSlug({$gt:""})` false.
  - `db.test.ts` (uses `startTestDb`, `beforeAll` timeout 120 s): `connectDb` twice returns the same connection (one `mongoose.connection.readyState === 1`); `User` has a unique index on `email` (a second insert of the same email rejects with code 11000); `AuditLog.collection.indexes()` contains a TTL index with `expireAfterSeconds: 7776000`; `mongoose.get("sanitizeFilter") === true` and `mongoose.get("strictQuery") === "throw"`; `User.find({ nope: 1 })` rejects (strictQuery); `inTransaction` commits on success and **rolls back** on a thrown error (insert a Setting inside, throw, assert zero documents after).
- [ ] **Step 2: Run to confirm failure** — `npx vitest run core/shared/ids.test.ts tests/integration/db.test.ts` → FAIL (modules not found).
- [ ] **Step 3: Implement** the files above. `connectDb` applies the two `mongoose.set` calls at module load.
- [ ] **Step 4: Build-bundle spike.** Add a throwaway server import of `connectDb` from `app/playground/page.tsx`'s module graph (or a temp route), run `npm run build`, and confirm `scripts/check-build.mts` still passes (Mongoose/mongodb/argon2/ioredis must stay external, not bundled — otherwise `child_process`/`vm` strings trip the check). If bundling trips it, add the offending packages to `serverExternalPackages` in `next.config.ts` and record why in ADR-010. Remove the throwaway import after.
- [ ] **Step 5: Run tests** → PASS. Commit: `feat(server): add db connection, models and branded ids`.

---

### Task 2: Repositories (plain domain types, injection-safe)

**Files:**
- Create: `server/repositories/{types,userRepository,roleRepository,snippetRepository,auditRepository,settingRepository}.ts`
- Test: `tests/integration/repositories.test.ts`
- Modify: `eslint.config.mjs`, `tests/tooling/eslint-boundaries.test.ts`

**Interfaces:**
- Produces (`types.ts`): `RoleName = "user" | "admin"`; `UserStatus`; `UserRecord { id: UserId; email; passwordHash; displayName; role: RoleName; status: UserStatus; sessionVersion: number; createdAt: Date; updatedAt: Date; lastLoginAt: Date | null }`; `RoleRecord { name: RoleName; permissions: readonly string[] }`; `SnippetRecord`; `AuditEntry` shape is owned by Task 5 (the repository takes it as input).
- Produces (`userRepository`, object of functions; every write/read takes optional trailing `session?: ClientSession`):
  `create(input: { email: string; passwordHash: string; displayName: string; role?: RoleName }): Promise<{ ok: true; user: UserRecord } | { ok: false; reason: "email_taken" }>` (maps Mongo code 11000);
  `findById(id: UserId)`, `findByEmail(email: string)`: `Promise<UserRecord | null>`;
  `recordLogin(id, at: Date)`; `setStatus(id, status)`, `setRole(id, role)`, `setPasswordHash(id, hash)` — the last three `$inc` `sessionVersion` and return the updated `UserRecord | null`;
  `countActiveByRole(role: RoleName): Promise<number>`.
- Produces: `roleRepository.upsertAll(roles: readonly RoleRecord[])`, `findByName(name): Promise<RoleRecord | null>`; `settingRepository.get(key: string): Promise<unknown | null>`, `.set(key: string, value: unknown)`; `auditRepository.insertMany(entries)`, `.listRecent({ event?: string; limit: number })`; `snippetRepository.create(...)`, `.findBySlug(slug: string)`, `.listByOwner(ownerId: UserId)`.
- ESLint: a new `no-restricted-imports` pattern bans `@/server/db/models/*` (and relative equivalents) everywhere except `server/repositories/**` and `server/db/**`; add `allowModels` to the `restrict()` helper for those two globs.

- [ ] **Step 1: Write failing tests** (`repositories.test.ts`, `startTestDb`, `reset()` in `beforeEach`):
  - Returned users are plain objects (`Object.getPrototypeOf(user) === Object.prototype`, no `_id`/`__v`, `id` is a 24-hex string); dates are `Date`.
  - `create` twice with the same email → second is `{ ok: false, reason: "email_taken" }`.
  - **Operator injection:** with a user `a@b.co` stored, `userRepository.findByEmail({ $ne: null } as unknown as string)` resolves `null` (NOT the user), and `snippetRepository.findBySlug({ $ne: null } as unknown as string)` resolves `null` with a snippet stored. `userRepository.findById({ $ne: null } as unknown as UserId)` rejects or resolves `null`, never returns a user.
  - `setRole`/`setStatus`/`setPasswordHash` each increment `sessionVersion` by exactly 1.
  - `listRecent({ event: "x", limit: 2 })` returns newest first, at most 2.
  - `tests/tooling/eslint-boundaries.test.ts`: linting `server/auth/x.ts` containing `import "@/server/db/models/User"` yields the restricted-import error; the same import in `server/repositories/x.ts` and `server/db/x.ts` is clean.
- [ ] **Step 2: Run to confirm failure** — `npx vitest run tests/integration/repositories.test.ts tests/tooling/eslint-boundaries.test.ts`.
- [ ] **Step 3: Implement** repositories (`.lean()` then map via a private `toUserRecord`) and the ESLint rule.
- [ ] **Step 4: Run tests + `npm run lint`** → PASS. Commit: `feat(server): add repositories and models-import boundary`.

---

### Task 3: Permissions, roles seed, seed script

**Files:**
- Create: `server/auth/permissions.ts`, `server/db/seed.ts`, `scripts/seed.mts`, `tests/integration/seed.test.ts`, `server/auth/permissions.test.ts`
- Modify: `package.json` (devDependency `tsx`; script `"seed": "tsx --conditions=react-server scripts/seed.mts"`), `.env.example` comment for `ADMIN_BOOTSTRAP_EMAIL`

**Interfaces:**
- Produces (`permissions.ts`): `PERMISSIONS` readonly tuple and `type Permission` = `"compile" | "snippet:create" | "snippet:update_own" | "snippet:delete_own" | "snippet:share" | "snippet:fork" | "snippet:moderate" | "user:list" | "user:ban" | "user:role" | "audit:read" | "metrics:read" | "ratelimit:configure"`; `ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]>` implementing the RBAC matrix (user = `compile` + the snippet own-rows; admin = all); `ANON_PERMISSIONS: readonly Permission[]` = `["compile"]`; `can(granted: readonly Permission[], needed: Permission): boolean`.
- Produces (`seed.ts`): `seed(opts?: { adminEmail?: string }): Promise<{ rolesUpserted: number; promotedAdmin: boolean }>` — idempotent: upserts both Role docs from `ROLE_PERMISSIONS`, calls `ensureIndexes()`, and, if `adminEmail` is given **and that user already exists**, sets their role to `admin`. It never creates users (ADR: an unverified-email registration must not be able to claim admin).
- `scripts/seed.mts` connects, runs `seed({ adminEmail: getEnv().ADMIN_BOOTSTRAP_EMAIL })`, prints counts, disconnects, exits non-zero on error.

- [ ] **Step 1: Write failing tests:** `can(ROLE_PERMISSIONS.user, "user:ban") === false`, `can(ROLE_PERMISSIONS.admin, "user:ban") === true`; every `Permission` appears in `ROLE_PERMISSIONS.admin`; anon has only `compile`. `seed.test.ts`: running `seed()` twice leaves exactly 2 Role docs; with `adminEmail` of an unregistered address `promotedAdmin === false` and no user was created; with a registered user it becomes `admin` and `sessionVersion` increments.
- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement.** `npm i -D tsx`. Verify `npm run seed` against the memory replset is not needed; instead run `npx tsx --conditions=react-server -e "import('./server/db/seed.ts')"`-style smoke only if a local `mongod` is available, otherwise state in the report that the CLI wrapper was verified by typecheck only.
- [ ] **Step 4: Run tests** → PASS. Commit: `feat(server): add RBAC permissions and idempotent seed`.

---

### Task 4: Request context and rate limiting (both stores)

**Files:**
- Create: `server/security/requestContext.ts`, `server/security/rateLimit/{store,memoryStore,redisStore,limits,rateLimiter}.ts`
- Test: `server/security/requestContext.test.ts`, `server/security/rateLimit/{memoryStore,limits,rateLimiter}.test.ts`, `server/security/rateLimit/store.contract.ts` (shared contract, not a test file itself), `server/security/rateLimit/redisStore.test.ts`

**Interfaces:**
- Produces (`requestContext.ts`): `clientIp(headers: Headers): string` — the **last** entry of `x-forwarded-for` (assumes exactly one trusted proxy appends the real peer; the first entry is client-controlled), else `x-real-ip`, else `"unknown"`; `hashIp(ip: string): string` — hex HMAC-SHA256 keyed with a domain-separated key derived from `getEnv().SESSION_SECRET`; `type RequestContext = { requestId: string; ipHash: string }`; `requestContextFrom(headers: Headers): RequestContext` (uses `x-request-id` or a fresh `crypto.randomUUID()`); `getRequestContext(): Promise<RequestContext>` over `await headers()`.
- Produces (`store.ts`): `type BucketConfig = { capacity: number; refillPerSec: number }`; `type ConsumeResult = { allowed: boolean; remaining: number; retryAfterSec: number }`; `interface RateLimitStore { consume(key: string, cfg: BucketConfig, nowMs: number): Promise<ConsumeResult> }`.
- `MemoryRateLimitStore` — `new MemoryRateLimitStore({ maxKeys?: number })` (default 10,000; on overflow evicts the least-recently-updated key). `RedisRateLimitStore` — `new RedisRateLimitStore(redis: Redis)`; one atomic Lua script (`EVAL`), key prefix `rl:`, `PEXPIRE` ≈ 2× full-refill time. Retry-after is `ceil(seconds until 1 token)`.
- Produces (`limits.ts`): `type RateLimitScope = "compile.anon" | "compile.user" | "auth" | "snippet.write"`; `DEFAULT_LIMITS: Record<RateLimitScope, { limit: number; windowSec: number }>` = 20/60, 60/60, 5/60, 30/60; `createLimitsProvider(opts: { load: () => Promise<unknown | null>; now: () => number; ttlMs?: number })` → `{ get(): Promise<typeof DEFAULT_LIMITS>; invalidate(): void }` (30 s cache; invalid shape or load failure → defaults, and the defaults are cached for the same TTL so a Mongo outage costs one slow call per 30 s, not one per request).
- Produces (`rateLimiter.ts`): `createRateLimiter(deps: { store: RateLimitStore; limits: LimitsProvider; now: () => number }): { check(scope: RateLimitScope, key: string): Promise<ConsumeResult> }`; module export `rateLimiter: { check(...); invalidateLimits(): void }` — the lazily built default (Redis when `getEnv().REDIS_URL`, else memory with a one-time production `console.warn`; limits loaded from `settingRepository.get("rateLimits")`). Bucket: `capacity = limit`, `refillPerSec = limit / windowSec`; key `"<scope>:<key>"`. Auth key convention (used by Task 7): `` `${ipHash}:${sha256(email)}` ``.

- [ ] **Step 1: Write failing tests**
  - `clientIp`: `"1.1.1.1, 2.2.2.2"` → `"2.2.2.2"`; only `x-real-ip` → that; none → `"unknown"`. `hashIp("1.2.3.4")` is 64 hex chars, stable, and differs from `hashIp("1.2.3.5")`; `requestContextFrom` keeps a given `x-request-id`.
  - **Store contract** (`runStoreContract(makeStore)`): capacity 3 → first 3 consume allowed with `remaining` 2,1,0; the 4th is `{ allowed: false, retryAfterSec: >= 1 }`; after advancing `nowMs` by `1/refillPerSec` seconds exactly one more is allowed; separate keys don't interfere; `retryAfterSec` is an integer. Run for memory always; run for Redis only when `process.env.REDIS_TEST_URL` is set (`describe.skipIf`), and say so in the report.
  - Memory store: with `maxKeys: 100`, consuming 1,000 distinct keys keeps `size <= 100` (Review Focus 5); the most recently used key survives eviction.
  - Limits: `get()` merges a valid override (`{ "compile.anon": { limit: 2, windowSec: 60 } }`) over defaults; an override with `limit: -1` or unknown scope → defaults; `load` rejecting → defaults without throwing; a second `get()` within 30 s does not call `load` again; after 31 s it does.
  - `rateLimiter.check("compile.anon", k)` allows exactly 20 calls then denies (fake `now`).
- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement.** Zod `.strict()` for the override doc.
- [ ] **Step 4: Run tests** → PASS. Commit: `feat(server): add request context and token-bucket rate limiting`.

---

### Task 5: AuditLogger

**Files:**
- Create: `server/audit/AuditLogger.ts`
- Test: `server/audit/AuditLogger.test.ts`, `tests/integration/audit.test.ts`

**Interfaces:**
- Produces: `type AuditEvent = "auth.register" | "auth.login" | "auth.login_failed" | "auth.logout" | "auth.password_changed" | "rbac.denied" | "ratelimit.hit" | "csrf.rejected" | "compile.rejected" | "compile.slow" | "sandbox.timeout" | "snippet.moderated" | "user.role_changed" | "user.banned"` (`csrf.rejected` is an addition; note it in an ADR); `type AuditEntry = { event: AuditEvent; severity: "info" | "warn" | "critical"; actorId?: UserId; ipHash: string; requestId: string; details?: Record<string, string | number | boolean | null>; codeHash?: string }`.
- `class AuditLogger { constructor(opts: { sink: (entries: readonly AuditEntry[]) => Promise<void>; maxQueue?: number /* default 1000 */; flushDelayMs?: number /* default 250 */ }); log(entry: AuditEntry): void; flush(): Promise<void>; readonly dropped: number }` — `log` never throws and never awaits; when the queue is full it drops the **oldest** entry and increments `dropped`; a failing sink drops that batch, increments `dropped`, and `console.error`s only the count (never entry contents); `details` keys matching `/code|source|password|secret|token/i` are removed before queueing.
- `hashCode(source: string): string` — hex SHA-256.
- `auditLogger` — singleton on `globalThis`, sink = `auditRepository.insertMany`.
- `withAudit<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { event: AuditEvent; severity?: "info" | "warn" | "critical"; actor?: (o: { args: A; result?: R }) => UserId | undefined; details?: (o: { args: A; result?: R; error?: unknown }) => AuditEntry["details"] }): (...args: A) => Promise<R>` — runs `fn`, then logs once (also when `fn` throws, then rethrows) using `getRequestContext()`.

- [ ] **Step 1: Write failing tests:** `log` returns synchronously (`undefined`) and the sink is not called until flush; `flush()` delivers entries in order; with `maxQueue: 3` and 5 logs, the sink receives the last 3 and `dropped === 2`; a rejecting sink does not throw from `flush()` and increments `dropped`; `details: { code: "evil()", reason: "x" }` reaches the sink as `{ reason: "x" }`; `hashCode("a")` equals the known SHA-256 of `"a"`; `withAudit` logs once on success with the result-derived actor and once (then rethrows) on failure. Integration: entries written through `auditLogger` appear via `auditRepository.listRecent`.
- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement.** Timer-based flush must be `unref()`'d so it never keeps the process alive.
- [ ] **Step 4: Run tests** → PASS. Commit: `feat(server): add bounded audit logger`.

---

### Task 6: Passwords, session, validation, DAL

**Files:**
- Create: `server/auth/{password,session,dal}.ts`, `server/validation/auth.ts`, `server/security/taint.ts`, `tests/integration/helpers/fakeNext.ts`
- Test: `server/auth/password.test.ts`, `server/validation/auth.test.ts`, `tests/integration/dal.test.ts`
- Modify: `server/env.ts` (call `taintSecret`)

**Interfaces:**
- Produces (`password.ts`): `hashPassword(plain: string): Promise<string>` (argon2id, `memoryCost: 19456, timeCost: 2, parallelism: 1`); `verifyPassword(hash: string, plain: string): Promise<boolean>`; `verifyAgainstDummy(plain: string): Promise<void>` (burns an equal-cost verify against a lazily built dummy hash, so unknown-email logins take as long as wrong-password ones).
- Produces (`session.ts`): `type SessionData = { userId: string; role: RoleName; sessionVersion: number }`; `SESSION_COOKIE_NAME` (`"__Host-sl_session"` when `NODE_ENV === "production"`, else `"sl_session"`); `sessionOptions(): SessionOptions` (`password: getEnv().SESSION_SECRET`, `ttl: 604800`, cookie `httpOnly`, `secure` in production, `sameSite: "lax"`, `path: "/"`); `getSession(): Promise<IronSession<SessionData>>` over `getIronSession<SessionData>(await cookies(), sessionOptions())`.
- Produces (`validation/auth.ts`, all `.strict()`): `RegisterInput { email, password, displayName }`, `LoginInput { email, password }`, `ChangePasswordInput { currentPassword, newPassword }`; `type AuthFormState = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]> }`. Email: trimmed, lowercased, ≤ 254, valid; password: string, 12–128 chars; displayName: trimmed, 1–50, no control chars.
- Produces (`dal.ts`): `type CurrentUser = { id: UserId; email: string; displayName: string; role: RoleName; permissions: readonly Permission[] }` (DTO; never carries `passwordHash`); `getCurrentUser: () => Promise<CurrentUser | null>` (wrapped in React `cache`) — reads the session, loads the user, returns `null` unless `status === "active"` **and** `sessionVersion` equals the cookie's; permissions come from `roleRepository.findByName` (30 s in-memory cache; missing Role doc → empty permissions, fail closed); `requireUser(): Promise<CurrentUser>` (calls `unauthorized()` from `next/navigation`); `requireRole(role: RoleName): Promise<CurrentUser>` (`forbidden()` after logging `rbac.denied`); `authorize(permission: Permission): Promise<{ ok: true; user: CurrentUser } | { ok: false; status: 401 | 403 }>` — 401 when anonymous, 403 (+ `rbac.denied` audit entry with `details: { permission }`) when authenticated but not permitted.
- Produces (`taint.ts`): `taintSecret(value: string): void` — calls `experimental_taintUniqueValue` from `react` against `globalThis` when that export exists, no-op otherwise (vitest).
- Produces (`fakeNext.ts`): `installFakeRequest(): { cookies: Map<string,string>; headers: Headers; setIp(ip: string): void }` plus the `vi.mock` factories for `next/headers` (`cookies()` returning `get/getAll/set/delete`, `headers()`); sets `process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true"` so the real `forbidden()`/`unauthorized()` throw their documented HTTP-fallback errors (digest `NEXT_HTTP_ERROR_FALLBACK;403|401`); fall back to mocking `next/navigation` if the real functions can't run under Vitest.

- [ ] **Step 1: Write failing tests**
  - `password.test.ts`: hash starts with `$argon2id$v=19$m=19456,t=2,p=1$`; `verifyPassword` true/false; two hashes of the same password differ.
  - `validation/auth.test.ts`: email `"  Alice@X.COM "` → `"alice@x.com"`; password length 11 and 129 rejected, 12 and 128 accepted; `{ email: { $ne: null } }` rejected (type); extra key rejected (`.strict()`); displayName with `\u0000` rejected.
  - `dal.test.ts` (real DB, fake `next/headers`): no cookie → `getCurrentUser() === null`; valid session → DTO with no `passwordHash` key; **tampered cookie** (flip a char) → `null`; **banned** user with a valid cookie → `null`; **sessionVersion bump** (`userRepository.setRole`) → `null` (revocation); `requireUser()` anonymous throws the 401 fallback error; `authorize("user:ban")` as a `user` → `{ ok:false, status:403 }` and exactly one `rbac.denied` audit row after `auditLogger.flush()`; as `admin` → `{ ok:true }`.
- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement.** Read the authentication and data-security guides first; the DAL is the enforcement point, `proxy.ts` is only optimistic.
- [ ] **Step 4: Run tests** → PASS. Commit: `feat(server): add session, password hashing and data access layer`.

---

### Task 7: Auth service and Server Actions

**Files:**
- Create: `server/auth/authService.ts`, `server/actions/auth.ts`
- Test: `tests/integration/auth.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6.
- Produces (`authService.ts`): all return `AuthResult = { ok: true; user: CurrentUser } | { ok: false; code: "invalid_credentials" | "email_taken" | "rate_limited" | "invalid_current_password"; retryAfterSec?: number }`:
  `register(input: RegisterInput, ctx: RequestContext)`, `login(input: LoginInput, ctx: RequestContext)`, `logout(ctx: RequestContext): Promise<void>`, `changePassword(user: CurrentUser, input: ChangePasswordInput, ctx: RequestContext)`.
  Behavior: rate limit `auth` first (key = `ipHash:sha256(email)`; deny → `rate_limited` + `ratelimit.hit` audit); `login` for an unknown email calls `verifyAgainstDummy`; unknown email, wrong password **and banned user** all return the same `invalid_credentials` (the audit `details.reason` distinguishes `unknown_email|bad_password|banned`); on success call `session.destroy()` then set `{ userId, role, sessionVersion }` and `save()` (session regeneration), `recordLogin`; `changePassword` verifies the current password, writes the new hash (which bumps `sessionVersion`), then re-issues the caller's session so they stay signed in while every other session is revoked. Wrap with `withAudit` for `auth.register|auth.login|auth.login_failed|auth.logout|auth.password_changed`.
- Produces (`actions/auth.ts`, `"use server"`): `registerAction(prev: AuthFormState, formData: FormData): Promise<AuthFormState>`, `loginAction(prev, formData)`, `logoutAction(): Promise<void>`, `changePasswordAction(prev, formData)`. Each parses `FormData` through the Zod schemas (field errors → `fieldErrors`), builds context via `getRequestContext()`, maps `AuthResult` to `AuthFormState` (never echoes the password), and on success of register/login calls `redirect("/playground")`.

- [ ] **Step 1: Write failing tests** (`auth.test.ts`; fake request, real DB; call the actions directly and catch `NEXT_REDIRECT`):
  - register → login round trip: session cookie is set, `getCurrentUser()` returns the user, stored `passwordHash` starts with `$argon2id$`.
  - **Generic error:** wrong password, unknown email and banned user all produce the identical `AuthFormState` (deep-equal `message`), and the three audit rows carry different `details.reason`.
  - **Banned user rejected** even with the correct password; and a banned user's pre-existing session stops resolving.
  - **Revocation:** after `login` in two fake browsers, `changePassword` in one makes the other's `getCurrentUser()` `null` while the first stays signed in.
  - **Login limit:** 5 wrong attempts for the same IP+email, the 6th is `rate_limited` (even with the right password), the same email from another IP is unaffected.
  - **Review Focus 1:** `Promise.all` of two `register` calls with `"Alice@X.com "` and `"alice@x.com"` → exactly one `ok`, the other `email_taken`, `User.countDocuments` is 1 (via `userRepository`/DB handle, not the model).
  - Unknown-email login still invokes the dummy verify (spy on `verifyAgainstDummy`).
  - Audit rows exist for `auth.register`, `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_changed`, `ratelimit.hit`, and none contains the password or its hash.
- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** → PASS. Commit: `feat(server): add register/login/logout/change-password actions`.

---

### Task 8: User administration (ban, role change) and admin actions

**Files:**
- Create: `server/auth/userAdmin.ts`, `server/validation/admin.ts`, `server/actions/admin.ts`
- Test: `tests/integration/rbac.test.ts`

**Interfaces:**
- Produces (`userAdmin.ts`): `type AdminResult = { ok: true } | { ok: false; code: "not_found" | "self" | "last_admin" }`; `banUser(actor: CurrentUser, targetId: UserId, ctx: RequestContext): Promise<AdminResult>`; `changeUserRole(actor: CurrentUser, targetId: UserId, role: RoleName, ctx: RequestContext): Promise<AdminResult>`. Rules: target ≠ actor (`self`); inside `inTransaction`: apply the write (bumps `sessionVersion`), then `countActiveByRole("admin", session)` must be ≥ 1, otherwise throw a private `LastAdminError` so the transaction **rolls back** and the result is `last_admin`. Audit `user.banned` / `user.role_changed` (`details: { from, to }`, `actorId`) only after commit.
- Produces (`validation/admin.ts`): `AdminTargetInput` — `{ userId: UserId-shaped 24-hex string }`; `RoleChangeInput { userId; role: "user" | "admin" }`, `.strict()`.
- Produces (`actions/admin.ts`, `"use server"`): `banUserAction(input: unknown): Promise<AdminActionResult>` and `changeUserRoleAction(input: unknown): Promise<AdminActionResult>` where `type AdminActionResult = { ok: true } | { ok: false; status: 400 | 401 | 403 | 404 | 409; code: string }`. Order: `authorize("user:ban" | "user:role")` (→ 401/403) → Zod parse (→ 400) → service (`not_found`→404, `self`/`last_admin`→409). Actions return result objects rather than calling `forbidden()` so callers and tests see an HTTP-like status (ADR).

- [ ] **Step 1: Write failing tests** (`rbac.test.ts`):
  - **403:** a `user` calling `banUserAction({ userId })` gets `{ ok:false, status:403 }`, the target is unchanged, and one `rbac.denied` audit row exists; anonymous gets 401.
  - **Operator injection:** as admin, `banUserAction({ userId: { $ne: null } })` → `status: 400` and no user changed.
  - Admin bans a user → target `status === "banned"`, `sessionVersion` +1, target's `getCurrentUser()` is `null` on the next request, `user.banned` audit row has `actorId` = admin. Role change likewise writes `user.role_changed` with `{ from: "user", to: "admin" }`.
  - **Not self:** admin banning/demoting themselves → 409 `self`, unchanged.
  - **Last admin / rollback (Review Focus 4):** with admins A and B, `Promise.all([A demotes B, B demotes A])` → at most one succeeds, `countActiveByRole("admin") >= 1` afterwards; with a single admin plus a non-admin actor path, demoting the only admin is rejected and its `role`/`sessionVersion` are exactly as before (proves the rolled-back write).
  - Unknown id → 404.
- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement.** If the concurrent A/B test is flaky because of write-conflict retries, assert the invariant (≥ 1 admin) rather than which request wins.
- [ ] **Step 4: Run tests** → PASS. Commit: `feat(server): add admin ban and role-change with last-admin guard`.

---

### Task 9: Sandbox worker pool (stub worker)

**Files:**
- Create: `server/security/sandbox/pool.ts`, `server/security/sandbox/compile-worker.mjs`, `tests/fixtures/sandbox/{loop-forever,alloc-bomb}.mjs`
- Test: `server/security/sandbox/pool.test.ts`

**Interfaces:**
- Produces: `type SandboxResult = { status: "ok"; value: unknown; ms: number } | { status: "timeout" } | { status: "crashed"; reason: "out_of_memory" | "error" } | { status: "busy" }`; `class SandboxPool { constructor(opts: { workerPath: string | URL; size?: number /* default 2 */; timeoutMs?: number /* default 2000 */; maxOldGenerationSizeMb?: number /* default 64 */; maxQueue?: number /* default 32 */ }); run(input: unknown): Promise<SandboxResult>; close(): Promise<void> }`; `getSandboxPool(): SandboxPool` (singleton on `globalThis`, default worker = `compile-worker.mjs`).
- Worker protocol: parent posts `{ id, input }`, worker replies `{ id, value }`. `compile-worker.mjs` is a **stub**: replies `{ stub: true, bytes: <UTF-8 byte length of input.code>, lang }` — it must not evaluate `input`. On timeout: `worker.terminate()`, resolve `timeout`, spawn a replacement; on `error`/`exit` mid-job (including `ERR_WORKER_OUT_OF_MEMORY`) resolve `crashed` and replace; when `maxQueue` jobs are already waiting resolve `busy`.

- [ ] **Step 1: Write failing tests:** stub worker returns `status: "ok"` with `value.stub === true`; `loop-forever.mjs` (a `while(true){}` fixture, repo-owned) with `timeoutMs: 200` → `timeout` within ~1 s, and the **next** `run` on the same pool still succeeds (replacement worker); `alloc-bomb.mjs` with `maxOldGenerationSizeMb: 16` → `crashed` / `out_of_memory`, pool still usable; 10 concurrent runs on `size: 2` all resolve and results map to their own inputs; `maxQueue: 1` with a blocked worker → a later run resolves `busy`; `close()` terminates all workers (no open handles).
- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement** with `node:worker_threads`, `resourceLimits: { maxOldGenerationSizeMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }`, `new Worker(new URL("./compile-worker.mjs", import.meta.url))`.
- [ ] **Step 4: Production-path spike.** Task 11 wires the route; here, only record the intended mechanism. After Task 11, `next build && next start` must successfully answer `POST /api/compile`. If Turbopack does not emit/trace the `.mjs` for `new URL(..., import.meta.url)`, switch the default `workerPath` to `path.join(process.cwd(), "server/security/sandbox/compile-worker.mjs")` and add `outputFileTracingIncludes` for `/api/compile`. Phases 2–3 must also solve how the real `core/` interpreter is bundled for this worker; record that as an open risk, not a Phase 1 task.
- [ ] **Step 5: Run tests** → PASS. Commit: `feat(server): add worker_threads sandbox pool with stub worker`.

---

### Task 10: CSRF and route guard

**Files:**
- Create: `server/security/csrf.ts`, `server/security/routeGuard.ts`, `app/api/csrf/route.ts`
- Test: `server/security/csrf.test.ts`, `tests/integration/routeGuard.test.ts`

**Interfaces:**
- Produces (`csrf.ts`): `CSRF_COOKIE = "sl_csrf"`, `CSRF_HEADER = "x-csrf-token"`; `issueCsrfToken(): string` — `"<32 random bytes base64url>.<HMAC-SHA256(domain-separated SESSION_SECRET, random)>"`; `verifyCsrf(cookieValue: string | undefined, headerValue: string | null): boolean` — both present, equal, and the HMAC verifies, compared with `timingSafeEqual` (signed double-submit, so a sibling-subdomain cookie injection can't forge a pair); `checkOrigin(headers: Headers, requestUrl: string): boolean` — `Origin` must exist, must not be `"null"`, and its host must equal `x-forwarded-host ?? host` (same rule as Next's Server Action check).
- Produces (`routeGuard.ts`): `guardMutation(request: Request): Promise<{ ok: true; ctx: RequestContext } | { ok: false; response: Response }>` — runs `checkOrigin`, then reads the `sl_csrf` cookie from `request.headers` and calls `verifyCsrf`; any failure → `403` JSON `{ error: "csrf" }` plus a `csrf.rejected` audit entry. `jsonError(status: number, error: string, extra?: HeadersInit): Response`.
- `GET /api/csrf` (route file stays thin): returns `{ token }`, sets the `sl_csrf` cookie (`sameSite: "lax"`, `secure` in production, `httpOnly: false` so the client can echo it, `path: "/"`), `Cache-Control: no-store`.

- [ ] **Step 1: Write failing tests:** `issueCsrfToken` tokens differ per call and verify with themselves; tampered signature, mismatched header/cookie, missing either → `false`; token signed under another secret → `false`. `checkOrigin`: matching → true; **missing `Origin`, `Origin: null`, `Origin: https://evil.example`, and a host mismatch via `x-forwarded-host`** → false (Review Focus 3). `guardMutation` with a bad pair → 403 and one `csrf.rejected` audit row; with a good pair → `{ ok: true }`. `GET /api/csrf` sets the cookie and the returned token verifies against it.
- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** → PASS. Commit: `feat(server): add signed double-submit CSRF and origin checks`.

---

### Task 11: `POST /api/compile`

**Files:**
- Create: `server/validation/compile.ts`, `app/api/compile/route.ts`
- Test: `tests/integration/compile-route.test.ts`

**Interfaces:**
- Produces (`validation/compile.ts`): `CompileInput` `.strict()` `{ code: string; lang: "js" | "ts" }` — `code` ≤ 10,240 **bytes** (UTF-8, not UTF-16 length), no NUL or other control chars except `\n\t\r`; `MAX_BODY_BYTES = 16 * 1024`; `readBoundedJson(request: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 }>` — reads the body stream incrementally and aborts once `maxBytes` is exceeded (does not trust `Content-Length`).
- Route (`export async function POST(request: Request): Promise<Response>`) pipeline, in this order: `guardMutation` → `getCurrentUser()` → rate limit (`compile.user` keyed `userId`, else `compile.anon` keyed `ipHash`; deny → 429 with `Retry-After` and a `ratelimit.hit` audit entry) → `readBoundedJson` → `CompileInput` parse (failure → 400 + `compile.rejected` with `codeHash` when code was readable) → `getSandboxPool().run(...)` → `timeout` ⇒ 503 `{ error: "sandbox_timeout" }` + `sandbox.timeout`; `crashed`/`busy` ⇒ 503; `ok` ⇒ 200 `{ stub: true, diagnostics: [] }` (+ `compile.slow` when `ms > 500`). Response headers: `Cache-Control: no-store`.

- [ ] **Step 1: Write failing tests** (real DB, fake request; helper issues a valid CSRF pair + matching `Origin`):
  - Happy path → 200, `body.stub === true`.
  - **429 once the bucket is empty:** set the `rateLimits` Setting to `compile.anon: { limit: 2, windowSec: 60 }` (and call `rateLimiter.invalidateLimits()`), third request → 429, `Retry-After` is an integer ≥ 1, and a `ratelimit.hit` audit row exists. A logged-in user draws from `compile.user`, not the anonymous bucket.
  - Invalid bodies → 400 and `compile.rejected` rows hold `codeHash` (64 hex) and **never** the code: `"\u0000"`, a control char, 10,241 bytes, a 10,000-char string of 3-byte characters (byte cap, not length cap), unknown extra key, `lang: "py"`, `code` as an object.
  - **Review Focus 2:** a 1 MB body with `Content-Length` omitted (streamed) and one with a lying `Content-Length: 10` → 413, and the reader stops early (assert via a counting stream that fewer than `MAX_BODY_BYTES + chunkSize` bytes were pulled).
  - Missing CSRF / wrong Origin → 403 (before any rate-limit token is spent: the bucket is unchanged).
  - Sandbox timeout (inject a pool built on `loop-forever.mjs` via `vi.mock` of `getSandboxPool`) → 503 + `sandbox.timeout` audit row.
  - **No DB:** with Mongo unreachable the route still answers (limits fall back to defaults; audit failures are swallowed) within a few seconds — assert on the limits-provider fallback (Task 4's rejecting-`load` test) plus a sink that rejects, not by stopping the replset.
- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement** (route file composes only; logic in the modules above).
- [ ] **Step 4: Run tests** → PASS. Commit: `feat(server): add guarded /api/compile stub`.

---

### Task 12: Security headers, CSP, `proxy.ts`

**Files:**
- Create: `server/security/headers.ts`, `proxy.ts`, `server/security/headers.test.ts`
- Modify: `next.config.ts` (`experimental: { authInterrupts: true, taint: true }`), `app/layout.tsx` (async; `await connection()` from `next/server` so every page renders per request and receives the nonce), `e2e/security.spec.ts` (new)

**Interfaces:**
- Produces (`headers.ts`): `buildCsp(opts: { nonce: string; dev: boolean }): string` — directives: `default-src 'self'`; `script-src 'self' 'nonce-<n>' 'strict-dynamic'` (+ `'unsafe-eval'` only when `dev`); `style-src 'self' 'nonce-<n>'` (+ `'unsafe-inline'` when `dev`); `img-src 'self' blob: data:`; `font-src 'self'`; `connect-src 'self'`; `worker-src 'self' blob:`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`. No `upgrade-insecure-requests` (it breaks the http e2e server; HSTS covers production). `securityHeaders(opts: { nonce: string; dev: boolean; https: boolean }): Record<string, string>` — CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `X-Frame-Options: DENY`, and `Strict-Transport-Security: max-age=31536000; includeSubDomains` only when `https`. `generateNonce(): string` (16 random bytes, base64).
- `proxy.ts`: `export function proxy(request: NextRequest)` — sets/forwards `x-request-id` (reuse a well-formed incoming one else `crypto.randomUUID()`), `x-nonce` and `Content-Security-Policy` on the **request** headers (so Next applies the nonce while rendering) and the security headers on the response; for `/dashboard/:path*` and `/admin/:path*` only, redirects to `/login?next=<path>` when the session cookie is **absent** (optimistic; no DB access, no unsealing). `config.matcher` per the CSP guide (skip `_next/static`, `_next/image`, `favicon.ico`; skip prefetches). API routes stay matched so they get `x-request-id`.
- Spike first (Step 1): confirm `proxy.ts` can import `server/security/headers.ts` (which has `import "server-only"`) in a production build. If the build rejects it, move the pure builders to `lib/security/headers.ts` (no `server-only`, no Node APIs), re-export from `server/security/headers.ts`, and record the choice in an ADR. The same applies to the session cookie name used by the proxy.

- [ ] **Step 1: Spike** as above; keep the result for the ADR.
- [ ] **Step 2: Write failing tests** (`headers.test.ts`): production CSP does **not** contain `unsafe-eval` and contains `worker-src 'self' blob:`, `frame-ancestors 'none'`, the nonce; dev CSP contains `'unsafe-eval'`; nonces differ per call and are valid base64; HSTS present only when `https`; `Permissions-Policy` denies camera/microphone/geolocation; `proxy` redirect behavior is covered at e2e level. `e2e/security.spec.ts` (no DB needed): `/playground` response has a CSP header with a nonce and no `unsafe-eval`, `x-request-id`, `x-content-type-options: nosniff`; loading `/playground` produces **no** console messages matching `Content Security Policy`; `POST /api/compile` without `Origin` → 403; `GET /api/csrf` → 200 with a token; `/admin` unauthenticated → redirect to `/login`.
- [ ] **Step 3: Run to confirm failure** — `npx vitest run server/security/headers.test.ts`.
- [ ] **Step 4: Implement**, then `npm run build` and `npm run e2e` (production build is what ships; CSP must not break hydration or fonts). If inline `style=` attributes in SSR output violate `style-src`, record the exact violation as an open risk for Phase 6 (do not add `'unsafe-inline'` in production).
- [ ] **Step 5: Run tests** → PASS. Commit: `feat(server): add nonce CSP, security headers and proxy`.

---

### Task 13: Docs, final verification, reviews

**Files:**
- Modify: `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md` (add `npm run seed` row; keep the project section < 60 lines), `.env.example` if wording changed, `docs/FIDELITY.md` (no change expected; confirm)

- [ ] **Step 1: ADRs** (short, newest last, ADR-010 onward) for every deviation actually taken: `authInterrupts` + `taint` experimental flags and why; `forbidden()` only in pages, action/route results elsewhere; nonce CSP forces dynamic rendering, no `upgrade-insecure-requests`; client IP = last `X-Forwarded-For` entry; seed via `tsx` (exception to ADR-009) and the seed never creates admins; password policy 12–128 and registration reveals "email taken" (no email verification yet); signed double-submit CSRF and the extra `csrf.rejected` event; models-import lint rule; sandbox worker path/bundling outcome; any `serverExternalPackages`/`proxy` import decisions from Tasks 1 and 12.
- [ ] **Step 2: ARCHITECTURE.md** — replace the "Server" bullet with the layered flow (proxy → DAL → services → repositories) and the request pipeline for `/api/compile`.
- [ ] **Step 3: Full verification, output shown:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (includes `check-build`), `npm run e2e`. Map each PROMPT "done when" bullet to its test in the report (table below). `npm run conformance` is not required (not a core phase) but run it once to confirm nothing regressed.
- [ ] **Step 4: Reviews:** run `/code-review` on the phase diff and the `security-review` skill (Phase 1 requires it); fix agreed findings, list rejected ones with reasons.
- [ ] **Step 5: Report and stop** with: what was built, verification output, ADR list, fidelity gaps (none expected), open risks (below). Commit docs: `docs: phase 1 decisions and architecture`. Wait for review.

**"Done when" → test map**

| PROMPT Phase 1 bullet | Test |
|---|---|
| register and login, incl. generic error | `tests/integration/auth.test.ts` |
| banned user rejected | `auth.test.ts`, `dal.test.ts` |
| revocation through `sessionVersion` | `auth.test.ts`, `dal.test.ts` |
| 403 for a user on an admin action | `rbac.test.ts` |
| 429 once the bucket is empty | `compile-route.test.ts` |
| transaction rollback | `db.test.ts`, `rbac.test.ts` (last admin) |
| operator injection neutralized | `repositories.test.ts`, `rbac.test.ts` |
| audit row for `rbac.denied` | `dal.test.ts`, `rbac.test.ts` |

## Open risks / follow-ups (to carry into the report)

- **Redis store is unverified on machines without Redis** (no Docker here): its contract test runs only with `REDIS_TEST_URL`.
- **Real interpreter in the sandbox worker (Phases 2–3):** the worker is a plain `.mjs`; bundling `core/` TypeScript into a `worker_threads` entry needs its own solution.
- **Login/register UI, `forbidden.tsx`/`unauthorized.tsx` pages, unban, snippet CRUD** are Phase 6/8; no pages exist for `/login`, `/dashboard`, `/admin` yet, so the proxy redirect lands on a 404 until then.
- **CSP vs. later UI:** CodeMirror and Motion inject styles; they need the nonce (`EditorView.cspNonce`) and no SSR `style=` attributes. Check in Phase 6.
- **IP trust:** correct only behind exactly one trusted proxy (documented in the ADR).
- **`experimental.taint` switches React to the experimental channel** for the app directory; re-evaluate when stable (Phase 9).
