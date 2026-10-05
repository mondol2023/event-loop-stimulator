# Decisions

Short ADRs for choices that deviate from, or interpret, `PROMPT.md`. Newest last.

## ADR-001: "core/ imports only core/" allows pure npm libraries (Phase 0)

**Context.** §6.2 says `core/` imports only `core/`, but §5 makes `core/frontend/parse.ts` use `@babel/parser`, and Zod validates worker messages.

**Decision.** The ESLint rule for `core/` bans:
- other app layers (`server`, `features`, `components`, `lib`, `app`, `tests`, `scripts`)
- React, Next and `server-only`
- all Node built-ins

It allows pure npm packages.

**Consequence.** Reviewers must check that every new `core/` dependency is pure: no I/O, clock or randomness. Golden and conformance tests from Phase 2 also guard the determinism principle.

## ADR-002: features/ may import `lib/` and `server/actions/*` (Phase 0)

**Context.** §6.2 lists `core/` and `components/` for `features/`. However, §7.7 has the client reach the server through Server Actions, and a client component calls an action by importing it. `lib/utils.ts` (`cn`) is the shared helper that shadcn components use.

**Decision.** `features/` may import `lib/` and `server/actions/**`. It may import nothing else under `server/`.

## ADR-003: Dark theme via `.dark` class on `<html>`, light as the `:root` base (Phase 0)

**Context.** The product is dark-first, but shadcn components use the `dark:` variant, which keys off a `.dark` ancestor.

**Decision.** `<html class="dark">` is the default. Light tokens live in `:root`, and the theme switch toggles the class.

**Consequence.** shadcn output works unmodified. The theme toggle must also avoid a flash of the wrong theme on load.

## ADR-004: Env validated in `instrumentation.ts`, skipped during `next build` (Phase 0)

**Context.** §5 asks for a fail-fast check on boot. `register()` runs once per server instance, but secrets should not be required to build.

**Decision.**
- `register()` calls `getEnv()` when `NEXT_RUNTIME === "nodejs"` and `NEXT_PHASE !== "phase-production-build"`.
- The env schema is not `.strict()`, because `process.env` always carries unrelated variables.
- Empty optional values count as unset.

**Consequence.** Verified: `next start` without env logs "Invalid environment configuration", names each key, and refuses to prepare the server. However, Next 16.3 prints "Ready" before the hook error and does not exit the process itself, so the process manager should treat that log line as fatal.

## ADR-005: Learner-selectable usage mode (Phase 0, from the PRODUCT.md interview)

**Context.** The human asked for all three modes (Self-study, Interview prep and Classroom), with **the user choosing** the mode through a visible control rather than the product prioritizing one.

**Decision.** `PRODUCT.md` records this as a capability. What each mode changes (speed, theme, density, predict-first prompts) is decided during `impeccable shape` for the playground in Phase 6.

**Consequence.** This is a scope addition to PROMPT.md §8. It is not built in Phase 0.

## ADR-006: Tooling deviations from §5 (Phase 0)

- **`@types/node`** was bumped from ^20 to ^24, to match the Node 24 runtime and satisfy Vitest 5's peer range.
- **`cn`.** shadcn's current Radix "nova" preset ships `cn` from shadcn's own `cn` package (`github.com/shadcn-ui/cn`), instead of clsx + tailwind-merge. We kept the generated output.
- **`playwright`.** The unused runtime dependency was removed in favor of `@playwright/test` (dev).
- **`turbopack.root`** is pinned, because a lockfile in a parent directory on the dev machine confused root detection.
- **Rejected token suggestions.** `ui-ux-pro-max --design-system` suggested monospace headings, GSAP scroll reveals and "light not recommended". All three were rejected per §8.1: mono is for code only, GSAP was removed, and the light theme is required for projectors.

## ADR-007: Zod runs `jitless`, imported only via `core/shared/zod.ts` (Phase 0)

**Context.** Zod v4 JIT-compiles object parsers with `new Function`, after probing with `Function("")`. The probe showed up in the server bundle. That is runtime code generation (of our schemas, not user code), but §2.1 bans `new Function` outright, and the Phase 1 CSP without `'unsafe-eval'` would block it in the browser.

**Decision.**
- `core/shared/zod.ts` calls `z.config({ jitless: true })` and re-exports `z`.
- ESLint bans importing `zod` (and `zod/*`) anywhere else.
- `core/shared/zod.test.ts` spies on `globalThis.Function` and proves that parsing never constructs one. A control run against bare `zod` constructed it twice.

**Consequence.** Parsing is a little slower than with the JIT, which is irrelevant at our input sizes. Zod keeps the flag on `globalThis`, so any process that imports Zod through this module is covered.

## ADR-008: Scope of the code-execution exception, and the build check (Phase 0)

**Context.** §6.2 exempts `scripts/conformance/` and `tests/conformance/` from the code-execution bans, because "those directories need `child_process`".

**Decision.**
- **Least privilege.** The exception lifts only the `child_process` ban. `eval`, `Function`, `ShadowRealm` and `vm` stay banned there too.
- **ShadowRealm.** It is banned as an identifier, so `new ShadowRealm()` and `globalThis.ShadowRealm` are both caught.
- **Build check.** `scripts/check-build.mts` runs at the end of `npm run build`. It scans `.next/static` and `.next/server` (skipping source maps) for `eval(`, `child_process`, `vm` and `ShadowRealm`. It does not scan for `Function(`, because Next's legacy `nomodule` core-js polyfill contains `Function("return this")`. That polyfill only reaches that branch on engines without `globalThis`, which are never served our modern bundle.

**Consequence.** If a future dependency ships one of these APIs into the bundle, the build fails, and the dependency needs an ADR or a replacement.

**Hardening after code review.**
- **Dynamic loads.** `no-restricted-imports` only sees static imports, so every banned specifier is also enforced on `import()` and `require()` via `no-restricted-syntax`. A computed `import()` specifier is banned outright (§2.1: "no dynamic `import()` of user text").
- **Indirect forms.** `eval` and `Function` are banned as any reference, like `ShadowRealm`. That catches `(0, eval)(…)`, `window["eval"]` and `new globalThis.Function(…)`.
- **Known limit.** Lint cannot see every route to the Function constructor, for example `(() => {}).constructor`. The build check and the CSP without `'unsafe-eval'` are the backstops.

## ADR-009: Conformance scripts are `.mts` run by Node's type stripping (Phase 0)

**Context.** `conformance:record` must run on the pinned real Node, with no build step in between.

**Decision.**
- The scripts are `.mts`, so Node treats them as ES modules without `"type": "module"` in `package.json`, which would change how every `.js` config file resolves.
- Node 24 strips the types natively.
- Imports carry their `.mts` extension, so `tsconfig.json` enables `allowImportingTsExtensions`. This is valid because the project is `noEmit`.

**Consequence.** These scripts may only use erasable TypeScript syntax: no `enum`, `namespace` or parameter properties.

**Phase 0 scope.** `conformance:record` verifies the pinned runtime and reports zero fixtures. `conformance` runs `tests/conformance/` (the target-pin tests for now). The recorder, runner and generator land in Phase 2.

## ADR-010: Bundling spikes: nothing needed `serverExternalPackages`; `proxy.ts` may import `server/` (Phase 1)

**Context.** Phase 1 puts Mongoose, argon2, ioredis, iron-session and a `worker_threads` pool behind the build check, which fails on `child_process`/`vm`/`eval` strings in `.next/`.

**Decision.** Three spikes, all run against `npm run build` and `npm run e2e` (production build):
- **Server dependencies.** The route graph for `/api/compile` pulls in Mongoose, the MongoDB driver, argon2 and ioredis. `scripts/check-build.mts` still passes, so `next.config.ts` has no `serverExternalPackages`.
- **`proxy.ts` imports.** It imports `server/security/headers.ts` and `server/auth/sessionCookie.ts`, both with `import "server-only"`, and the build accepts it. The cookie name lives in its own module so the proxy does not load iron-session, the env parser or `next/headers`. Both modules use only Web APIs.
- **Worker path.** `new URL("./compile-worker.mjs", import.meta.url)` resolves under `next start`: `e2e/security.spec.ts` posts to `/api/compile` on the production server and gets the stub answer. No `outputFileTracingIncludes` is needed.

**Consequence.** Open risk, not a Phase 1 task: Phases 2-3 must bundle the real `core/` interpreter (TypeScript) into the worker entry, which the plain `.mjs` stub does not exercise.

## ADR-011: `authInterrupts` and `taint` are on; `forbidden()` only in pages (Phase 1)

**Context.** `forbidden()`/`unauthorized()` (next/navigation) need `experimental.authInterrupts`. React's `experimental_taintUniqueValue`, which stops secrets from being serialized to the client, needs `experimental.taint`.

**Decision.**
- Both flags are on in `next.config.ts`. `server/env.ts` taints `SESSION_SECRET`, `MONGODB_URI` and `REDIS_URL`; the call is a no-op where the API is absent (Vitest).
- `requireUser()`/`requireRole()` throw the interrupts and are for pages. Server Actions and Route Handlers use `authorize()` or return a status object (`AdminActionResult`, JSON errors), so callers and tests see an HTTP-like status instead of a thrown fallback.

**Consequence.** `experimental.taint` switches the app directory onto React's experimental channel; re-evaluate in Phase 9 when it is stable.

## ADR-012: Nonce CSP forces per-request rendering; no `upgrade-insecure-requests` (Phase 1)

**Context.** A nonce is minted per request in `proxy.ts`; Next applies it only while server-rendering.

**Decision.**
- `app/layout.tsx` is async and awaits `connection()`, so every page renders per request. The routes show as dynamic in the build output.
- Production CSP: `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'nonce-…'`, `worker-src 'self' blob:`, `frame-ancestors 'none'`, and no `'unsafe-eval'`. Development adds `'unsafe-eval'` and `'unsafe-inline'` styles (React debugging, HMR).
- `upgrade-insecure-requests` is omitted: it breaks the http e2e server, and HSTS (sent only over https) covers production.
- The proxy skips prefetches and static assets, and still matches `/api/*` so every response carries `x-request-id`.

**Consequence.** Open risk for Phase 6: CodeMirror and Motion inject styles, which need the nonce (`EditorView.cspNonce`) and no SSR `style=` attributes. The current pages produce no CSP console messages (checked in e2e). Production never gets `'unsafe-inline'` for styles.

## ADR-013: The client IP is the last `X-Forwarded-For` entry (Phase 1)

**Decision.** Rate limiting and audit key on `clientIp()`: the last entry of `x-forwarded-for` (else `x-real-ip`, else `"unknown"`), HMAC-hashed with a key derived from `SESSION_SECRET`. The first entry is client-controlled; the last is what our one trusted proxy appended.

**Consequence.** Correct only behind exactly one trusted proxy. With none, a client can pick its own address and dodge per-IP limits; with two, all clients share the proxy's address. Raw addresses are never stored.

## ADR-014: Seeding runs through `tsx` and never creates admins (Phase 1)

**Context.** ADR-009 runs scripts with Node's type stripping, which cannot load `server/` modules (path aliases, `server-only`).

**Decision.** `npm run seed` is `tsx --conditions=react-server --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/seed.mts` (it loads the same env files as `next dev`), an exception to ADR-009. `seed()` is idempotent: it upserts the two Role documents and ensures indexes. With `ADMIN_BOOTSTRAP_EMAIL` set it promotes that user **only if they already exist**. It never creates a user, so an unverified registration cannot claim admin by being first.

**Consequence.** Bootstrapping an admin is two steps: register, then re-run the seed.

## ADR-015: Password policy 12-128, and registration says "email taken" (Phase 1)

**Decision.** New passwords must be 12-128 characters (argon2id, 19 MiB, t=2, p=1). Presented passwords (login, "current password") are only length-bounded, so the sign-in form cannot probe the policy and a later policy change cannot lock anyone out. Registration reports `email_taken`; login returns one generic error for unknown email, wrong password and banned account, with the real reason only in the audit row.

**Consequence.** Registration confirms that an address has an account (enumeration). Accepted until email verification exists; registration, login and password change are rate-limited per IP across all emails (`auth.ip`, 30 per 60 s) and per IP and email (`auth`, 5 per 60 s). The per-IP bucket stops an attacker rotating email addresses from one address; it does not stop a distributed one.

## ADR-016: Signed double-submit CSRF, and the `csrf.rejected` audit event (Phase 1)

**Decision.**
- Mutating Route Handlers call `guardMutation()`: `Origin` must be present, not `"null"`, and match `x-forwarded-host ?? host` (Next's Server Action rule); then `x-csrf-token` must equal the `sl_csrf` cookie and carry an HMAC made with a key derived from `SESSION_SECRET`. A cookie injected by a sibling subdomain cannot be signed, so it fails.
- Failures answer 403 and write a `csrf.rejected` audit row (reason only, never the token). This event is an addition to the spec's list.
- A request that fails the guard spends no rate-limit token and has no body read.
- The token is not bound to a session or user, so it proves only that the request carries a cookie this server signed. The Origin check is the primary defence; the token is the second layer. `GET /api/csrf` returns a still-valid cookie token unchanged instead of rotating it, so several tabs do not invalidate each other.
- Server Actions rely on Next's built-in Origin check.

## ADR-017: Lint boundaries added in Phase 1 (Phase 1)

**Decision.**
- Only `server/repositories/**` and `server/db/**` may import `server/db/models/*`.
- Integration tests (`tests/integration/**`) may import `app/api/**` route handlers, to call them directly. Every other import of `app/` stays banned.
- Both rules are proven in `tests/tooling/eslint-boundaries.test.ts`.

## ADR-018: Admin changes serialize through the acting admin's row (Phase 1)

**Context.** Two admins demoting each other write different documents. Under snapshot isolation both transactions commit and no admin is left (write skew), even though each checked "at least one admin remains".

**Decision.** `banUser`/`changeUserRole` first touch the actor's own row inside the transaction, so two concurrent admin changes conflict and the loser retries on fresh state. The transaction also checks that an active admin remains (else it rolls back: `last_admin`) and that the actor is still an active admin (else `forbidden`, 403), because the actor DTO was read before the transaction. `target === actor` (compared case-insensitively) is refused as `self`.

**Consequence.** Concurrent admin changes are serialized per actor pair; throughput is irrelevant at admin volumes.

## ADR-019: The data layer connects lazily (Phase 1)

**Context.** Nothing connected to Mongo at boot. Mongoose buffers an unconnected query for 10 s and then fails, so every request would have been slow and failed.

**Decision.** Repositories are wrapped in `withConnection()` and `inTransaction` calls `connectDb()`, which caches the connection on `globalThis`. A failed connect clears the cache, so the next call retries, and an outage fails after the 3 s server-selection timeout. `connectDb()` reads `MONGODB_URI` only when it has to connect.

**Consequence.** With Mongo down, `/api/compile` still answers (about 3 s on the first call per 30 s, since the limits provider caches its defaults).

## ADR-020: `/api/compile` limits and failure behaviour (Phase 1)

**Decision.**
- Body cap `MAX_BODY_BYTES` is 32 KiB: code may be 10,240 bytes and an ASCII-escaping serializer writes each 2-byte character as a 6-byte `\uXXXX` (3x, about 30.7 KB), so a smaller cap would reject valid programs near the limit. The body is read incrementally and abandoned at the cap (413), ignoring `Content-Length`.
- Rate limits: `compile.user` keyed by user id, else `compile.anon` keyed by hashed IP. If the limiter itself fails, the route answers 503 (fail closed). A failing limits read (Mongo) falls back to the defaults.
- A failing session lookup is treated as anonymous; failing audit writes are dropped (counted, never logged with contents).
- Sandbox `timeout`, `crashed` and `busy` all answer 503.
