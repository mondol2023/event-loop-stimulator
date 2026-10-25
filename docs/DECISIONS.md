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

## ADR-021: The Phase 2 subset: glue the spec list needs, and what stays refused (Phase 2)

**Context.** PROMPT.md §7.1 lists the subset's features but not the constructs a real program needs around them (assignment, `new Promise`, methods). It also does not say which of the remaining constructs are refused rather than approximated.

**Decision.**
- **Supported**: the §7.1 list plus assignment and compound assignment, `++`/`--`, `?:`, `new` (for `new Promise` and `new Error`), `this` (methods), `delete`, bitwise operators, sloppy and strict (`'use strict'`) scripts, top-level `return` (legal in CommonJS), `Math.{abs,ceil,floor,max,min,round,sign,sqrt,trunc}` (IEEE-exact), and `process.nextTick` as the only member of `process`. TypeScript is erasable syntax only.
- **Refused with a diagnostic and a hint**: classes (a stretch goal), `switch`, `do…while`, `for…in`, `for…of`, labeled statements, destructuring, spread/rest, `arguments`, `instanceof`, `in`, `with`, `require`/`import`/`export`, and everything §7.1 already excludes. Each can be added later, one at a time, with fixtures recorded on real Node.
- `core/frontend/subset/excluded.ts` is the single list. The excluded tables in `SUPPORTED_SUBSET.md` and `FIDELITY.md` are generated from it by `npm run docs:subset`, and `tests/tooling/subset-docs.test.ts` fails when they drift.
- Global names are resolved through scope analysis, not by matching member syntax: a local `Date` is the user's own, while `const r = Math.random`, `globalThis.Date` and `(0, eval)` are refused.

**Consequence.** A program outside the subset is never run wrongly, only refused. The list is deliberately short and flagged for human review: widening it is a fixtures-first change.

## ADR-022: How real bytecode is captured (Phase 2)

**Context.** The ratchet (ADR-023) needs V8's own `--print-bytecode` listing for the user's functions, but the listing has about 100 Node-internal blocks, and `--print-bytecode-filter` matches by name only.

**Decision.**
- **The primary path shipped.** `npm run conformance:record` runs each runnable program fixture a second time under the same sandbox as its recorded run, with `--print-bytecode --no-compact --no-flush-bytecode --require mark.cjs`. Neither fallback (dropping `--permission`, name filters) was needed.
- **Root.** `mark.cjs` calls a marker function just before Node compiles the main script; the main script is the first `Parameter count 6` block after it (CommonJS wraps the script in `function (exports, require, module, __filename, __dirname)`).
- **Children are found by SharedFunctionInfo address**, never by name: walk the constant pool of the root to each `<SharedFunctionInfo ADDR>` and match the block whose header carries that address. `--no-compact` keeps addresses stable; `--no-flush-bytecode` keeps each function compiled once. A duplicate address or a name mismatch aborts the record.
- **A function that was never called has no real bytecode.** V8 compiles lazily, so such a function is absent from `children`, and nothing verifies our bytecode for it. It is not an error.
- **Failure is loud.** Any surprise throws `BytecodeCaptureError` naming the fixture; so does a capture run whose exit code differs from the recorded outcome. A capture is never partial.
- A `.cts` fixture has Node's appended `//# sourceURL=` text removed from positions, so a `.cts` and its whitespace-stripped `.cjs` give identical trees.

**Consequence.** The output cap for a capture run is raised to 32 MiB. If a Node upgrade changes the listing shape, the record fails instead of recording something wrong.

## ADR-023: The bytecode fidelity ratchet and its exception policy (Phase 2)

**Context.** PROMPT.md §3.4 asks for the same opcode sequence as real V8 for every fixture function. Reaching that for every construct at once is not realistic, and a plain pass/fail test would either be red for weeks or hide regressions.

**Decision.**
- Each fixture with recorded bytecode has a status in `tests/conformance/bytecode-status.json`: `pending` (the generator cannot compile it, or some function's opcodes differ), `opcodes` (every function has V8's opcodes; the functions that differ in operands, positions or pool are listed as exceptions), or `exact`.
- The test fails on **any regression and on any unrecorded improvement**, so the file only ever moves forward. `npm run conformance:status` rewrites it from the generator's current output; it never touches an `*.expected.json`.
- An exception needs a real, written reason. A placeholder or empty reason fails the test. A `pending` fixture cannot carry exceptions, and an `exact` one cannot either.
- Every exception is also written up per fixture in `FIDELITY.md` ("Bytecode operand differences").
- At the end of Phase 2: 72 fixtures `exact`, 4 `opcodes`, 3 `pending` of 79.

**Consequence.** Fidelity can be claimed fixture by fixture, with the evidence in the repository. Adding a fixture is a deliberate step: it lands `pending` or with its exceptions explained.

## ADR-024: Harness boundaries, module layout and syntax errors (Phase 2)

**Context.** Three small questions needed one answer each: how test262's harness runs, where the view and compile code lives, and what happens to V8's own `SyntaxError` text.

**Decision.**
- **The test262 harness is host-provided.** test262's `assert.js`, `sta.js` and `doneprintHandle.js` use features outside the subset, so the Phase 3 simulator defines `assert`, `Test262Error`, `$DONE` and `print` as host builtins. A test may include only those three files; anything else puts it in `vendor/test262/exclusions.json` with a reason (`validator`, `include`, `feature`). The contract is `tests/conformance/test262/harnessContract.md`. `runTest262` is tested against stub simulators; the run over every vendored test (1,008 files, sloppy and strict) is an `it.todo` until the Phase 3 interpreter exists.
- **Layout.** `core/views` (the AST and Bytecode views, as `CodeViewStrategy`s) and `core/compile` (`CompilationManager`) join `core/frontend`, `core/bytecode` and `core/shared`. Views are pure emitters over a `BytecodeProgram`.
- **BOM.** `CompilationManager` strips one leading U+FEFF before anything else, because V8 never sees it. Every offset in a result is relative to the BOM-less text, and `hasBom` lets a caller shift them back.
- **A position with no range.** `sourceRangeForPos` returns `SourceRange | undefined`: an unknown function, an out-of-range offset, or an instruction before the first recorded position has none. V8's position table is sparse, so an instruction is attributed to the latest entry at or before its offset, in both directions.
- **V8's `SyntaxError` text is not reproduced.** A syntax error is our own `E_SYNTAX` diagnostic with a range and a hint, not V8's stderr. This is a recorded gap in `FIDELITY.md`.

**Consequence.** The simulator in Phase 3 must provide the harness builtins before the test262 `todo` can be turned on. UI code that maps a tick to source must handle a missing range.

## ADR-040: The timeline crosses the worker boundary as the serialized string (Phase 5, D1)

**Context.** The simulator runs in a Web Worker and the main thread needs the `TimelineStore`. ADR-030 already defines a serialized form with a shape check.

**Decision.** The worker posts `TimelineStore.serialize()` and the main thread calls `TimelineStore.deserialize`. Zod validates the message envelope only, with `timeline: z.string().max(TIMELINE_MAX_CHARS)` and `TIMELINE_MAX_CHARS = 20 * 1024 * 1024`. The tick contents are validated by `checkShape`, because a deep Zod parse of 5,000 ticks would cost more than the run.

**Consequence.** One copy of the timeline per run, and the same validation as ADR-030.

**Bundling (Task 1 spike; recorded here because D1 is the first decision about the worker boundary).** Path 1 shipped: Turbopack bundles `new Worker(new URL("<relative path>/pipeline.worker.ts", import.meta.url), { type: "module" })` from a client component, so `scripts/build-worker.mts`, `package.json`, `.gitignore` and `check-build.mts` did not change. Turbopack emits a small loader chunk (`turbopack-worker-*.js`, about 0.6 KB gz) that `importScripts()`s the worker chunks. In the spike's production build the worker payload was about 126.6 KB gz: `2phfj52684es1.js` (core pipeline and `@babel/parser`, 470,026 B raw, 122,171 B gz) and `turbopack-3yuz58scq3xoi.js` (runtime, 3,836 B gz). In the Task 10 build the worker entry was `turbopack-worker-2ru9m5gbh1na6.js` (558 B gz), which loads `2nu10niigy9y6.js` (612,921 B raw, 167 KB gz). Chunk names are content hashes and change per build; never hardcode them. The worker is fetched only when `new Worker` runs, so it is outside first-load JS. First-load JS for `/playground` measured about 232 KB gz in Task 10 against the 250 KB budget (175 KB at the spike). `check-build` scans `.next/static`, which includes the worker chunk, and passed. The CSP is unchanged (`worker-src 'self' blob:`).

## ADR-041: Two responses per job, `compiled` then `simulated` (Phase 5, D2)

**Context.** Compile is fast and simulate can be slow. The panes should fill before the run ends.

**Decision.** The worker posts `compiled` and later `simulated`. Applying a new job's `compiled` clears the old timeline in the same synchronous step (timeline holder emptied, `timelineVersion` bumped, playback reset to index 0 and length 0).

**Consequence.** Old ticks never pair with the new line index, and subscribers see one notification for the swap.

## ADR-042: A superseded in-flight job terminates the worker (Phase 5, D3)

**Context.** A worker cannot be interrupted mid-simulation, and a long run would block the next job.

**Decision.** When a job is dispatched while another is running, `PipelineClient` calls `worker.terminate()` and drops the worker; the next dispatch spawns a fresh one. The `jobId` check still guards every message.

**Consequence.** An old result can never arrive, at the cost of re-creating the worker.

## ADR-043: The main thread gets DTOs only (Phase 5, D4)

**Context.** Compiled programs hold heap graphs and closures that should not cross the boundary.

**Decision.** The `compiled` message carries `diagnostics`, `strippedJs`, the four materialized views, a `LineIndex`, `baselines: BaselineCode[]` (indexed by `FunctionId`), the boundaries and the run summary.

**Consequence.** Components read plain data, and the simulator never runs on the main thread.

## ADR-044: Playback rate is a presentation constant (Phase 5, D5)

**Context.** The learner needs a stepping speed that is readable and safe in a backgrounded tab.

**Decision.** 1x is 4 ticks/s (`BASE_TICKS_PER_SECOND = 4`), with speeds 0.25, 0.5, 1, 2, 4 and 8. Each frame's delta is clamped to `MAX_FRAME_DELTA_MS = 250`, and playback stops at the last tick. The owner may change the base rate; it is one constant.

**Consequence.** Speed never affects the timeline, only which tick is shown.

## ADR-045: The worker attaches a TieringModel; natives and test262 stay unreachable (Phase 5, D6)

**Context.** The asm and tier panes need tier data from the run (ADR-037). The worker must not widen the surface that ADR-026 and ADR-031 closed.

**Decision.** The worker attaches a `TieringModel`. The request schema is `.strict()` with no `natives` or `host` key, so `natives: true` and `host: "test262"` are rejected, as are non-positive or fractional `jobId`s and unknown `lang`s.

**Consequence.** Client runs are always the user-program host.

## ADR-046: One store per PlaygroundProvider (Phase 5, D7)

**Context.** A module singleton would leak state between tests and between future embeds.

**Decision.** Each `PlaygroundProvider` creates its own Zustand store. The timeline lives in a `WeakMap<PlaygroundStore, TimelineStore>` holder, outside React and Zustand state (the spec's "module ref", scoped per store). Store state carries only `timelineVersion`, which bumps on each swap so that selectors re-run.

**Consequence.** Tests and embeds are isolated, and the store never diffs or clones a large timeline.

## ADR-047: Playback key refinements, and the worker CSP gap (Phase 5)

**Context.** Global shortcuts must not fight focused widgets, and Task 13 found one gap in the worker's CSP.

**Decision.**
- **Space.** It is ignored on a button-like target (button, summary, `role=button|switch|checkbox`), which activates on Space itself. A repeated Space is consumed (default prevented) without toggling, so a held key neither flickers playback nor scrolls the page.
- **Widget roles.** Inputs, contenteditable and ARIA widget roles (slider, spinbutton, textbox, combobox, listbox, tab, tablist, menu, menuitem, radiogroup, radio) own all shortcut keys, including Home and End.
- **`play()` at the last tick** restarts from tick 0.
- **`initialJobId`.** The client starts counting from the store's current job number, so a client re-created by Fast Refresh does not restart at 1 and have the store drop its events.
- **Failed before compiled.** A `failed` event for a job whose `compiled` has not arrived clears the previous run's views, timeline and hover, because they belong to the old source.
- **Over-long source.** The client validates the request against the protocol schema and emits `failed` itself, because the worker drops an invalid request without replying.

**Known gap.** The pipeline worker script is served from `/_next/static` without its own CSP header (`proxy.ts` skips that path), and a worker takes its CSP from its own response, so the browser-level `unsafe-eval` ban does not apply inside the worker. The guards are the lint bans, `check-build` and Zod's `jitless` mode. Fixing it needs a server-layer headers change for the worker chunk; it is deferred.

**Consequence.** Keys behave like the platform's own widgets, and the worker's "never execute" guarantee rests on static checks, not on the browser.
