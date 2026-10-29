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

**Context.** §6.2 exempts `scripts/conformance/` and `tests/conformance/` from the code-execution bans, because "those directories need `child_process`". Phase 4 widens what they may spawn: real node, and `llvm-mc` on asm text the repo generated (`scripts/conformance/asm-record.mts`, D4).

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

## ADR-025: Refused fixtures are judged by refusal, not by stderr bytes (Phase 3, D1)

**Context.** The three `ts-*-refused` fixtures use TypeScript that Node's strip-only loader refuses. Node's stderr for them is an `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` code frame with loader-internal frames, which is not program behavior and which the simulator should not reproduce. Principle 2 is "refuse rather than approximate" (ADR-024 treats `SyntaxError` text the same way).

**Decision.** A fixture with `meta.expect: "refused"` must also carry `meta.diagnostic` (the meta schema rejects one without it). It passes when all three hold: real Node exited non-zero; the simulator refuses with exit code 1 and stderr lines `<code>: <message>` (the test262 contract's format); and the code equals `meta.diagnostic`, for example `E_TS_UNSUPPORTED`.

**Consequence.** Byte equality covers every program that runs. A refusal is checked by its code, so a changed diagnostic code is a visible fixture change, while Node's loader text can change with the target without touching us.

## ADR-026: Natives mode and feedback extraction make `internals` fixtures comparable by bytes (Phase 3, D2)

**Context.** The Map, elements-kind and IC claims of PROMPT.md §3 are checked against V8 itself (`%HaveSameMap`, `%HasSmiElements`, `%DebugPrint`), but those are not JavaScript the subset accepts, and `%DebugPrint` prints addresses and a great deal of V8-internal text.

**Decision.**
- `CompilationManager.compile(source, lang, { natives: true })` enables Babel's `v8intrinsic` plugin and compiles `%Name(args)` to `CallRuntime [Name]`, as V8 does under `--allow-natives-syntax`, for an allowlist: `HaveSameMap`, `HasFastProperties`, `HasSmiElements`, `HasDoubleElements`, `HasObjectElements`, `HasHoleyElements`, `HasDictionaryElements` and `DebugPrint`.
- **The option is unreachable from user input.** It is not in `CompileInput`, the worker message schema or any UI path, and a test proves it. Without it `%Name` is an ordinary syntax error.
- A fixture meta key `extract: "feedback"` makes the recorder keep only the `%DebugPrint` lines that name the function and the property-IC slots, normalized to `function NAME` / `slot #N KIND STATE`. Kept kinds: `LoadProperty`, `LoadKeyed`, `SetNamedSloppy`, `SetNamedStrict`, `SetKeyedSloppy`, `SetKeyedStrict` and `DefineNamedOwn`. Our `%DebugPrint` prints exactly those lines.
- The internals fixtures are recorded with `--allow-natives-syntax --no-lazy-feedback-allocation`, which matches our eager feedback model. Real V8's lazy allocation is a documented gap in `FIDELITY.md`.

**Consequence.** The "Verified model" claims for Maps, elements kinds and IC states rest on recorded V8 output compared byte for byte, not on our reading of V8's source. The price is a test-only compile mode that must never leak, hence the proof.

## ADR-027: How a run stops (Phase 3, D3)

**Context.** PROMPT.md §7.1 says a run that exceeds a limit ends with "Simulation limit reached — real Node would continue", never a JS error. Some behavior is also reachable at run time but cannot be made exact, and the compiler cannot see it.

**Decision.** A `SimulationStop` is one of two kinds: `{ kind: "limit", limit }` or `{ kind: "unsupported", reason }`.
- **Limits** (`core/shared/limits.ts`): `ticks` 5,000, `callDepth` 64, `heapObjects` 1,024 (cumulative allocations, independent of the Illustrative GC, so a GC can never change whether a limit hits), `virtualTime` 60,000 ms, and three additions to §7.1: `work` (1,000,000 element visits inside builtins, such as a `map` over `length = 2**32 - 1`), `output` (1 Mi characters of stdout and stderr together) and `strings` (8 Mi characters built by concatenation or `join`, cumulative). Real Node would continue past all three, so the notice stays true. `output` and `strings` came from a ~100-byte program that doubled a string and ran the compile worker out of heap: V8's fatal out-of-memory aborted the whole server process, because a worker thread's OOM is not contained.
- **Unsupported.** Execution reached something whose exact output is not modeled: a `console.log` with `%j`, `%o` or `%O`, a TypeError whose text would print an object, `Array.prototype.sort` of 64 or more elements, a `Number.prototype.toString` radix, and so on. `FIDELITY.md` lists every reason.
- Internally the interpreter and runtime throw `SimulationHalt`, which only `simulate` catches. Output up to that point is kept, and the notice goes to `warnings` and `stop`, **never** to stdout or stderr. The definitions live in `core/shared` because the layers below the timeline enforce the limits and may not import it.

**Consequence.** A hostile or merely large program ends at a defined place with the output it had produced. An unsupported stop is a gap, not a wrong answer: the fixtures prove that what is printed is exact, and the stop says where exactness ended.

## ADR-028: Tick granularity is statement-level, by the owner's ruling (Phase 3, D4)

**Context.** The plan followed PROMPT.md §7.5 (one Tick per bytecode dispatch, job start, loop-phase transition, GC event and exit) and required a measurement before relying on it: count the ticks of every program fixture and every vendored test262 test, and stop and ask the human if any needs more than 5,000.

**Decision.** The gate failed: with a tick per dispatch, `recursion-factorial` needs **28,491** ticks. The owner chose statement-level ticks (the other option was a different limit). A tick is now: a dispatch at a statement position (the `S>` marks of the bytecode listing), a `JumpLoop` back edge (so an empty loop body still ticks), the entry of a function, a job start, a loop-phase transition, a GC event and the exit. Every other dispatch belongs to the statement it sits in, and a job end only closes its start. `TickBoundary` is the one rule, used by both the limiter and the recorder, so recording never changes where a run stops.

**What the gate measures now** (`tests/conformance/tick-budget.test.ts`; measured on this branch): the highest of the 97 runnable program fixtures is `recursion-factorial` at 4,880 ticks, only 120 under the limit; the next is `inspect-circular-and-long-arrays` at 495. Across the 1,902 vendored test262 runs (every test, sloppy and strict) the highest is 298. Phase 3's `Tick` carries no `machine`, `cache`, `bus` or `alu` (Phases 4 and 7, Illustrative) and no `v8.tiers` (Phase 4's TieringModel); each later phase adds its field.

**Consequence.** The deviation from §7.5 is flagged for human review. A step is a statement, not a bytecode; Phase 4's bytecode-level stepping needs a view over the dispatch commands, which are still recorded. `recursion-factorial` is within 3% of the limit, so any change to what counts as a tick can break it, and the gate test says so.

## ADR-029: Maps follow V8 13.6, not PROMPT.md §7.4's wording (Phase 3, D5)

**Context.** §7.4 says a field-representation change makes the old Map "deprecated". Probing the pinned V8 gave two results that the plan first read as one rule ("generalizes in place").

**Decision.**
- `%HaveSameMap({x:1,y:2}, {x:"string",y:[1]})` is `true` (fixture `maps-same-shape-vs-order`): generalizing to Tagged is not a new Map.
- **Smi → Double does produce a new Map** (fixture `maps-field-generalization`). After `a.f = 1.5` on `{f:1}`, `a` no longer shares a Map with its Smi sibling `b`, yet a fresh `{f:3}` shares `a`'s new Map. The old Map is deprecated and objects migrate lazily: `b` matches again only after its own field generalizes. So "in place" was wrong for Smi → Double, and the model follows the fixture.
- `delete` of the last-added property leaves fast mode in the fixture that tests it, and the model follows that too.

**Consequence.** Every Map rule in `V8Map` and `TransitionTree` that a fixture probes has a recorded V8 result behind it. Rules no fixture probes (other representation changes, dictionary-mode thresholds beyond `delete`) are Modeled, not Verified.

## ADR-030: Size and storage of the timeline (Phase 3, D6)

**Context.** PROMPT.md §7.5 allows a 5,000-tick timeline within 20 MB. A tick carries console output, the object list, timers and queues, and most of it is unchanged from one tick to the next.

**Decision.** Ticks share their unchanged sub-objects by reference (structural sharing). `TimelineStore` keeps a full keyframe every 64 ticks and, in between, a patch of the keys whose reference changed (set, unset, or append for a console that only grew). It serves `at(i)` by replaying at most 63 patches, through an LRU of 256 materialized ticks. "20 MB" is the UTF-8 byte length of the serialized store, which is what crosses the worker boundary.

**Consequence.** `TimelineStore.test.ts` serializes a worst-case 5,000-tick run (growing output, 64 live objects, 3 live timers) and a real run that stops at a limit, and asserts both stay under the budget. Scrubbing reads from the LRU. Phase 5's worker owns the timeline; `/api/compile` never sends it (ADR-032).

## ADR-031: Test-only host modes (Phase 3, D7)

**Context.** The vendored test262 tests need `assert`, `Test262Error`, `$DONOTEVALUATE`, `$DONE` and `print` (ADR-024), which are not Node globals and must not exist in a user's program.

**Decision.** `SimulationOptions.host` is `"node"` (the default, and the only mode reachable from user input) or `"test262"`, which adds exactly the harness builtins that `tests/conformance/test262/harnessContract.md` specifies. Like natives mode (ADR-026), it is in no schema.

**Consequence.** Natives and test262 are options of `simulate`, not of a user message. The Phase 5 worker schema must keep both unreachable.

## ADR-032: `/api/compile` returns a summary and runs the real pipeline in a prebuilt worker (Phase 3, D8)

**Context.** Phase 1's route ran a stub worker (ADR-010 found a plain `.mjs` worker resolves under `next start`). The real pipeline is TypeScript that imports `core/`, and it can produce a timeline of up to 20 MB, while the client builds its own in its Web Worker (Phase 5). Task 24 had to find out how such an entry gets bundled.

**Decision.**
- The response is a `CompileSummary`: `{ diagnostics, output?: { stdout, stderr, exitCode }, warnings, stop?, tickCount }`, a `.strict()` Zod schema that the parent applies to every worker answer before using it. Streams, warnings and stop reasons are length-capped, so an oversized answer cannot reach the client. `output` is absent when the program was refused. The audit stays free of code (`codeHash` only).
- **Spike result: path 2 shipped.** Path 1 (`new Worker(new URL("./compile-worker.ts", import.meta.url))`) did not work, because Turbopack copies a TypeScript worker entry unbundled instead of bundling it. Path 2: `esbuild` (now a direct devDependency) bundles `compile-worker.ts` and the `core/` pipeline into `server/security/sandbox/dist/compile-worker.mjs` (`scripts/build-worker.mts`, run by `predev` and `prebuild`), and `outputFileTracingIncludes` ships it. `scripts/check-build.mts` scans that file too, so the no-`eval`/`child_process`/`vm` ban holds for the bundle. This closes ADR-010's worker risk.
- The pool keeps its 64 MB heap and 2 s timeout. A program that reaches the limit under a short `timeoutMs` answers `timeout` and audits `sandbox.timeout`.

**Consequence.** The worker is a resource guard, not the sandbox: nothing ever executes user code, which is the real safety property. A worker that runs out of heap can take the process down, which is why `output` and `strings` exist (ADR-027). The bundle is a build artifact (`npm run build:worker`, run by `predev` and `prebuild`), so a change under `core/` reaches the route only through a rebuild.

## ADR-033: Machine state is derived, not stored (Phase 4, D1)

**Context.** PROMPT.md §7.5 puts `machine` on every Tick. That would grow every tick of the 20 MB budget (ADR-030) with data that is a function of the tick and the compiled function.

**Decision.** The owner ruled that the Tick carries no `machine`. `machineStateAt(tick, baseline)` (`core/baseline/machineState.ts`) is a pure function returning `{ truth: "illustrative", asmLine, registers, flags }`, or `null` while no JS frame runs or the tick is not at a bytecode of that baseline. The state is the one on entry to the bytecode's first instruction, because a tick is reported before its bytecode executes. `registers` holds `rax` (the tagged accumulator: a Smi is `value << 1`, any other value an illustrative compressed pointer, derived from its `ObjectId` for objects), `rsi` (the context) and `rbp`/`rsp` (the frame), the last three illustrative. `flags` are set only at a `cmp` instruction (TestNull, TestUndefined, TestReferenceEqual, see As built; a `cmp` of the tagged words) and are `null` anywhere else.

**Consequence.** Ticks, `TimelineStore` and the 20 MB budget are unchanged. The asm and register views compute the state when a tick is shown.

**As built.** The projection is pure (the same tick and baseline give the same state) and nothing about it is stored on the Tick. `flags` are projected only when the instruction shown at that bytecode is a `cmp`: `TestNull`, `TestUndefined` and `TestReferenceEqual`. The other `Test*` bytecodes call a builtin, so the code shown for them has no `cmp` and `flags` is `null`. The register scheme is Illustrative and does not match the pinned Node build (ADR-039).

## ADR-034: Tier changes are not ticks (Phase 4, D2)

**Context.** A tier-up or deopt is not a step of the program, so it must not move where a run stops or add scrub positions.

**Decision.** The owner ruled that `TickBoundary` is untouched. When a `TieringModel` is attached, a recorded Tick gains `v8.tiers`, a `ModeledTiers` wrapper `{ truth: "modeled", byFunction: Record<FunctionId, Tier> }` (defined in `core/interpreter/tiering/TieringModel.ts`, carried by `core/timeline/Tick.ts`), and `v8.tierEvents`, an array of `TierEvent` (a tier-up, with an `osr` flag, or a deopt with a `DeoptimizeReason`) that is present only when events happened. The events are drained onto the next Tick that is recorded, and the narration names each one as Modeled. Without a model neither field exists.

**Consequence.** Events raised with no tick recorded at all are dropped. Otherwise `finish()` attaches the events still pending after the last tick to it. Several events can share one tick.

**As built.** `TickRecorder.finish()` attaches the events still pending after the last tick to that tick, so a run that ends on a limit or on a final non-tick step no longer drops them (with no tick recorded there is nothing to attach them to, and they are dropped). `FIDELITY.md` keeps the remaining gap. A `TierUpEvent` carries `invocations`, the function's invocation count when it fired. A run without a `TieringModel` is byte-identical to a run before Phase 4: neither field exists on its Ticks.

## ADR-035: Template coverage is exhaustive by type (Phase 4, D3)

**Context.** The asm pane must not drift from the bytecode pane, and a new opcode must not silently lack a template.

**Decision.** `TEMPLATES` in `core/baseline/templates/index.ts` is `satisfies Record<Opcode, Template>`, so a missing opcode is a compile error and needs no test. Every opcode starts as a stub that calls a named builtin, and hand-written templates override the ones Sparkplug emits inline. An opcode Sparkplug handles out of line is `call [r13 + IsolateData::builtin_entry(k<Name>)]` (`callBuiltin` in `core/baseline/Template.ts`; binary operations use `k<Op>_Baseline`), which exercises REX.B and an `r13` disp8. Register roles cite `register-x64.h` at the pinned V8.

**Consequence.** Templates are pure: the same bytecode gives the same instructions. The generator and runtime-call templates are the least faithful (`FIDELITY.md`).

**Asm is Illustrative, its bytes are exact.** The asm is the template translation of the shown bytecode and is not the code V8 would emit. The bytes are the exact encoding of the asm shown: `X64Encoder` (`core/baseline/x64/Encoder.ts`) is table-driven and resolves label fixups with branch relaxation, and ADR-036 cross-checks every form the compiler emits against a real assembler.

## ADR-036: `llvm-mc` or `clang` may run on repo-generated asm text (Phase 4, D4)

**Context.** The x64 encoder is hand-written, so its bytes need a real assembler as the oracle. ADR-008 scoped the `child_process` exception to running node.

**Decision.** The exception in `scripts/conformance/` and `tests/conformance/` now also covers `llvm-mc`, and only on asm text the repo generated, never user source. `npm run asm:record` (`scripts/conformance/asm-record.mts`) collects every distinct form the baseline compiler emits, assembles them to an object with `llvm-mc -filetype=obj` (or `clang -c -x assembler` as a fallback), reads the `.text` bytes and writes `tests/conformance/asm/encodings.expected.json`. It does not use `--show-encoding`, which prints a fixup placeholder for label branches. It refuses with install instructions when `llvm-mc` is missing (`LLVM_MC` overrides the path). `tests/conformance/asm.test.ts` compares the encoder with that file offline.

**Consequence.** The file is written only by the script, never by hand. `asm.test.ts` compares the encoder with it offline.

**As recorded.** `llvm-mc` is not installed on the owner's Windows machine, so the golden was recorded with clang 23.1.4's integrated assembler (`clang --target=x86_64-unknown-linux-gnu -c -x assembler`), not `llvm-mc`. `asm:record` prefers `llvm-mc` (`LLVM_MC` overrides the path) and falls back to `clang` (`CLANG`), refusing only when neither runs. Both are the same LLVM MC layer, and the recorder reads only the object's `.text` section, so a wrapper difference cannot reach the bytes. `encodings.expected.json` records which tool and version produced it (`assembler.tool`, `assembler.version`, `llvm`). The `it.todo` and tripwire remain in `asm.test.ts` only as the branch for a missing golden.

## ADR-037: The TieringModel is a Modeled observer (Phase 4, D5)

**Context.** Tiering must be teachable without ever influencing the Exact layer.

**Decision.** `core/interpreter/tiering/TieringModel.ts` implements two narrow interfaces. The interpreter sees only `TieringHooks` (`onInvoke`, `onBackEdge`, `onIcTransition`, `onBinaryOp`): void, fire-and-forget, over plain-data sites with no heap references. The timeline sees only `TieringReadout` (`tiers()`, `drainEvents()`). Flag defaults are those of V8 13.6.233.17 (`src/flags/flag-definitions.h`):
- Budgets are in bytecode bytes: a call charges the function's length, a back edge its loop's length. Thresholds are absolute multiples of the function's length: Sparkplug at 8, Maglev at 400, Turbofan at 3000, and at least 2 invocations before optimization.
- OSR from back edges: Sparkplug to Maglev at 100 loop lengths, Maglev to Turbofan at 500.
- An IC change or a deopt re-arms an optimization gate of 500 invocations (`minimum_invocations_after_ic_update`). A Maglev tier-up also sets a `turbofanGate` 3000 - 400 invocations ahead, so a re-Maglev after a deopt does not reach Turbofan on the next call.
- A property IC that gains a Map in optimized code deopts with `kWrongMap`. A binary-op hint (`kNone`, `kSignedSmall`, `kNumber`, `kAny`, kept only in the model) that widens deopts with `kNotASmi`, `kOverflow`, `kLostPrecision`, `kMinusZero` or `kNotANumber`. A deopt lands in Sparkplug if the function has baseline code, else in Ignition.
- A site's first feedback never deopts, and unary operators are not hooked (`FIDELITY.md`).

**Consequence.** Every value carries `truth: "modeled"`. The conformance suite gives identical results with the model attached, which is the proof that it never changes output.

**As built.** The tiers are `ignition`, `sparkplug`, `maglev` and `turbofan`, and the thresholds (8, 400, 3000) are compared with a bytecode-byte budget that calls and back edges both charge, so for a function without loops they equal call counts, not time. The model shows when V8 would typically switch; it does not record when it did (`FIDELITY.md`).

## ADR-038: `/api/compile` is unchanged by Phase 4 (Phase 4, D6)

**Context.** Tiers and machine code are timeline data, and ADR-032 keeps the timeline out of the route.

**Decision.** `CompileSummary` gets no tier or asm field. Tiers reach the client only through its own Web Worker (Phase 5).

**Consequence.** The route's schema, size caps and audit rows are as they were.

**Lazy views.** `views.asm` and `views.binary` on a compiled program are memoised getters, computed on first access, because the baseline code generator is about half of `compile()` time and `simulate()` never reads the views (about 3x faster compile when they are not accessed; measured once on a 9,954-byte, 78-function program: compile 107-111 ms to 39-43 ms, with the asm and binary views costing 71-82 ms when accessed; not a repo benchmark). A failing emit does not throw: the view is `unavailable` with `E_TEMPLATE: <message>` for a `RangeError` (a stack overflow in deeply nested code) or `E_INTERNAL: <message>` for any other throw, so `compile()` keeps its never-throws contract.

## ADR-039: The Smi, register and pointer model is Illustrative, not Node's layout (Phase 4)

**Context.** The asm and register panes need one tagged-value scheme. Probing the pinned Node 24.19.0 (V8 13.6.233.17) showed its build has pointer compression off and stores 32-bit Smis as `value << 32` in a 64-bit word, so `%IsSmi(2**30)` is true there (probed once on 24.19.0; not recorded as a fixture). Phase 3's `isSmi` is the 31-bit range (-2^30 to 2^30 - 1), and the Phase 4 panes were built on it.

**Decision.** The owner kept the model and labelled it (option 2) instead of switching to Node's layout. It is an Illustrative compressed-pointer scheme: `rax` holds `value << 1`, `r14` is a cage base, and a Smi overflows at 2**30. Map offsets, the Context layout and `InstanceType` numbers are likewise Illustrative. Elements-kind and `isSmi` consumers follow the 31-bit range, including the narration text "isn't a Smi". The comments in `core/baseline/illustrativePointers.ts`, `machineState.ts` and the check and context templates say so.

**Consequence.** `FIDELITY.md` lists the difference, and the panes are labelled Illustrative; no Exact output depends on it. The "Smi vs HeapObject tagging, pointer compression" row of the base table predates this ruling (see `FIDELITY.md`). The comments in `core/runtime/heap/estimatedSize.ts` and the title in `core/runtime/values/Smi.test.ts` were relabelled as illustrative.

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
- **Widget roles.** Inputs, contenteditable and ARIA widget roles (slider, spinbutton, textbox, combobox, listbox, tab, tablist, menu, menuitem, radiogroup, radio, and the `separator` of a resizable split) own all shortcut keys, including Home and End. The split handle also stops propagation of the keys it handles, as the Scrubber does.
- **`play()` at the last tick** restarts from tick 0.
- **`initialJobId`.** The client starts counting from the store's current job number, so a client re-created by Fast Refresh does not restart at 1 and have the store drop its events.
- **Failed before compiled.** A `failed` event for a job whose `compiled` has not arrived clears the previous run's views, timeline and hover, because they belong to the old source.
- **Over-long source.** The client validates the request against the protocol schema and emits `failed` itself, because the worker drops an invalid request without replying.

**Known gap.** The pipeline worker script is served from `/_next/static` without its own CSP header (`proxy.ts` skips that path), and a worker takes its CSP from its own response, so the browser-level `unsafe-eval` ban does not apply inside the worker. The guards are the lint bans, `check-build` and Zod's `jitless` mode. Fixing it needs a server-layer headers change for the worker chunk; it is deferred.

**Consequence.** Keys behave like the platform's own widgets, and the worker's "never execute" guarantee rests on static checks, not on the browser.

## ADR-048: No SSR `style=`, a nonce for every injected `<style>` (Phase 6, D1)

**Context.** Production CSP is `style-src 'self' 'nonce-…'` (ADR-012). An SSR `style="…"` attribute or an un-nonced `<style>` violates it, and such violations show only under `next start`. Task 2 spiked each widget in a production build and counted CSP console messages.

**Spike outcome (widget, violation, fix).**
- CodeMirror: one violation on load (style-mod injects a `<style>`). Fix: `EditorView.cspNonce.of(nonce)`. Zero afterwards for ordinary typing. Task 8 found one more case: typing over a selection made Chromium copy the replaced text's computed style onto the new text as an inline `style`, a production CSP violation. `SourceEditor` now handles `beforeinput`/`insertText` over a non-empty selection itself (`replaceSelection`) and leaves composition to the browser; an e2e test covers it.
- Motion `layoutId`: none (it styles through the CSSOM). Caveat: a `style` or `initial` prop on a server-rendered motion element would emit an SSR `style=`.
- shadcn Tooltip (Radix): none in the spike. Task 8 later found two Radix SSR attributes: `RovingFocusGroup` (ToggleGroup, TabsList) renders `style="outline:none"`, overridden by `style={{ outline: undefined }}` in the `components/ui` wrappers plus an `outline-none` class; `TabsContent` renders `style="animation-duration:0s"` on the first panel with no override, so the shell uses its own `TabPanel`.
- cmdk list: one violation and one SSR `style=` (an inline sr-only label). Fix: mount `Command` client-only; `CommandDialog` already is.
- shadcn Resizable (`react-resizable-panels` 4.15): six SSR `style=` attributes and six violations, with no nonce hook (see ADR-055).

**Decision.** `app/playground/page.tsx` reads `x-nonce` from `headers()` and passes it down through `NonceProvider`. CodeMirror instances take the nonce. Components that style inline render their styled nodes only on the client or set styles through refs. `tests/tooling/no-ssr-style.test.tsx` renders the server shell and fails on any ` style="` or `<style` without a nonce.

**Consequence.** CSP never gains `'unsafe-inline'`. The guard covers the initial server tree only; widgets that mount later are covered by the nonce rule and the Phase 6 e2e.

## ADR-049: The example catalog is generated from the recorded fixtures (Phase 6, D2)

**Context.** The "Matches Node" badge must never claim more than a recording supports, and `features/` must not import `tests/`.

**Decision.** `npm run examples:sync` writes `features/playground/examples/catalog.generated.ts` from a hand-written list (`examples.config.ts`) plus each fixture's source and `*.expected.json`. `tests/conformance/examples.test.ts` regenerates the catalog in memory and fails on drift, and fails when the simulator's stdout differs from a recorded outcome. The badge "Matches Node vX (V8 Y)" shows only when the editor text equals an example's source byte for byte. Anything else shows "Simulated by spec model".

**Consequence.** A user program is never labelled as matching Node. Expectation files stay written only by `conformance:record`.

## ADR-050: What each usage mode changes (Phase 6, D3)

**Context.** ADR-005 names three modes; the owner confirmed the proposal on 2026-10-25 (`docs/design/playground-shape.md`).

**Decision.** Self-study: user's theme, 1x type, 1x speed, dense, output live. Interview prep: 2x speed, dense, predict-first (ADR-061). Classroom: light theme (overridable), 1.125x root size, 0.5x speed, roomy. Mode and theme are the cookies `sl_mode` and `sl_theme`, read by `app/layout.tsx` so the first paint is right. Values are validated with Zod; an invalid value falls back to the default. The base rate stays 4 ticks/s at 1x (ADR-044).

**Consequence.** Positions never move between modes; only sizes and defaults do.

## ADR-051: The worker posts timeline markers (Phase 6, D4)

**Context.** The scrubber must not scan the timeline on the main thread.

**Decision.** `timelineMarkers(ticks)` in `core/timeline/boundaries.ts` returns one marker per job boundary and one per tick where a fidelity warning first appears. The `simulated` response carries `markers`.

**Consequence.** Drawing the scrubber costs one pass over the markers, not the timeline.

## ADR-052: The asm view carries both syntaxes (Phase 6, D5)

**Context.** An AT&T/Intel toggle must not be able to change bytes.

**Decision.** `AsmLine` gains `intel: string` beside the AT&T text, so the toggle is a client choice over one set of lines and bytes.

**Consequence.** The view DTO is slightly larger; the bytes are identical in both syntaxes by construction.

## ADR-053: Every code pane is a lazy CodeMirror 6 view (Phase 6, D6)

**Context.** First-load JS was about 232 KB gz after Phase 5 against a 250 KB budget (ADR-040).

**Decision.** All panes are CodeMirror 6, read-only except the editor, loaded through `next/dynamic(…, { ssr: false })` behind a fixed-height skeleton. One `highlightField` applies the playback line (`cm-sl-current`) and the hover outline (`cm-sl-hovered`), each also carrying `data-sl-highlight`. Decorations clamp to the document.

**Measured.** The first Task 8 build was 337.7 KB gz; about 91 KB of that was Zod, reached through `features/preferences/prefs.ts` and `worker/protocol.ts`. Loading `PipelineClient` with `import()` after hydration, and keeping Zod out of the client layout path, brought it to 247.9 KB. Lazy chunks at Task 8 (hashed names change per build): CodeMirror about 92 KB gz (`0o-tr_krzqpms.js`), Zod with protocol parsing about 90 KB gz (`312_jvqx-zi1g.js`). At Task 8 there was no lazy Motion chunk yet (task-8-report.md); Task 11's fix round B (commit 09780b9) loaded the event-loop view lazily to keep Motion out of the first load, and Task 14's fix round added the replace-example dialog chunk (`examples/ReplaceExampleDialog.tsx`, preloaded when the Examples menu or palette opens). The final figure and the overage are ADR-062.

## ADR-054: Diagnostics link to an in-app `/docs/subset` page (Phase 6, D7)

**Context.** `Diagnostic.docs` points at `docs/SUPPORTED_SUBSET.md`, which a learner cannot open in the app.

**Decision.** `/docs/subset` renders the excluded-construct table from `core/frontend/subset/excluded.ts`, the same source as `npm run docs:subset`. Each row has an anchor id, and one function maps `docs/SUPPORTED_SUBSET.md` to `/docs/subset#<code>`.

**Consequence.** The page and the docs cannot drift apart.

## ADR-055: Resizable panes use an in-house `ResizableSplit` (Phase 6, D8)

**Context.** Task 2's spike showed shadcn `Resizable` emitting six SSR `style=` attributes with no nonce hook. A client-only mount is clean but blanks the shell in SSR and flashes in on hydration.

**Decision.** `features/playground/components/ResizableSplit.tsx` sets sizes through refs (CSSOM), with keyboard-operable separators and double-click reset. No `react-resizable-panels` dependency.

**Consequence.** The shell server-renders without a style attribute.

## ADR-056: Panes use raw CodeMirror 6 packages, not `@uiw/react-codemirror` (Phase 6)

**Context.** PROMPT.md names `@uiw/react-codemirror`. The panes need a shared highlight field, a nonce extension (ADR-048) and exact control of mount and teardown.

**Decision.** Panes use the `@codemirror/*` packages directly. The wrapper was dropped in Task 7's fix round.

**Consequence.** We own the view lifecycle, which is small and covered by `highlightField.test.ts`.

## ADR-057: The hover-sync e2e is adapted (Phase 6)

**Context.** The plan's e2e expects hover to sync across the source, AST, bytecode and asm panes. Those panes are never co-visible in one viewport state.

**Decision.** The e2e asserts hover sync across the panes that can be shown together, and the line mapping is covered by unit tests. It does not claim four-way sync in one frame.

**Consequence.** Cross-pane hover is verified per visible pane set, not all at once.

## ADR-058: The palette's "Run" replays from the first tick (Phase 6)

**Context.** Compilation is automatic (ADR-042), so "Run" has nothing new to compile when no edit is pending.

**Decision.** "Run" flushes any pending debounce (`runNow`). If nothing was waiting and the run on screen is ready, it seeks to the first tick and plays.

**Consequence.** "Run" always starts a visible playback.

## ADR-059: Transport icons deviate from the brief (Phase 6, review item R3)

**Context.** The shape brief (§10.4) maps First and Previous job to different icons than media-player convention.

**Decision.** First uses `SkipBack` and Previous job uses `ChevronsLeft`. Every button keeps its `aria-label`, tooltip and `Kbd` hint.

**Consequence.** The icon set differs from `docs/design/playground-shape.md` by design.

## ADR-060: The 375 px "More playback" popover is deferred to Phase 7 (Phase 6, review item F17; closed by ADR-074)

**Context.** The brief moves First, Last and speed into a popover at 375 px. `components/ui` has no popover primitive, and adding Radix Popover grows first-load JS (ADR-062).

**Decision.** At 375 px the controls fit one row and speed plus tick take a second; narration keeps its fixed two lines. The popover is revisited in Phase 7's mobile pass.

**Consequence.** The compact bar uses two rows.

## ADR-061: Interview prep is predict-first; console and narration are withheld in core (Phase 6)

**Context.** Narration describes what the program printed, so hiding only the console would leak the answer.

**Decision.** Each `Tick` carries `narration` and `narrationWithheld` (the narration with the program's printed text left out), built in `core/timeline`. The UI picks one by mode and Reveal state, and the console shows "Predict the output, then reveal" until Reveal or the last tick. No regex redaction is applied.

**Consequence.** Withholding is structural and deterministic. Panes and the 2D view stay live, because stepping is how the learner checks the prediction.

## ADR-062: First-load JS is over the 250 KB budget (Phase 6; owner answered, see ADR-074)

**Context.** ADR-040 sets a 250 KB gz first-load budget for `/playground`. Measured as gzip -9 over every `<script src>` in the served HTML of `next start`: 247.9 KB at Task 8, 253.3 KB before Task 14's batch, and 252.8 KB at the end of Task 14 (modern browsers 214.2 KB, plus the `noModule` polyfill chunk).

**Decision.** Phase 6 ships 2.8 KB over the budget when the `noModule` chunk is counted, and under it for modern browsers. Whether the budget counts `noModule` was an owner decision; the owner answered in Phase 7 Task 1 that it does not, so the gate is the modern-browser figure (ADR-074). Automated enforcement is Phase 9.

**Consequence.** New first-load code in later phases must be lazy or offset by savings.

## ADR-063: Whole-timeline internals and hardware data is computed in the worker (Phase 7, D1)

**Context.** The tier timeline and hardware trace need a scan of every tick. Scanning on the main thread would block rendering, and storing them on each `Tick` would duplicate data.

**Decision.** `tierTimeline(ticks)` and `traceHardware(ticks, baselines)` are pure `core/` functions. The worker runs them once and the `simulated` response carries `tierTracks` and `hardware` beside `markers`. Per-tick values (frame, Maps, feedback, heap) still come from the Tick. The Illustrative cache, bus and ALU values are derived like ADR-033's machine state, not stored on the Tick.

**Consequence.** The whole-timeline tier and hardware data is computed once in the worker, so the main thread does not rebuild it (some panels still read ticks, for example the elements focus tracker walks back on a backward seek). Both arrays are capped in the protocol (`TIER_TRACKS_MAX`, and `LIMITS.ticks` for `hardware`; see ADR-071).

## ADR-064: The Illustrative hardware model: LRU caches, buses and ALU (Phase 7, D2)

**Context.** Phase 7 draws caches, buses and an ALU that no V8 output exposes.

**Decision.** `classifyInstruction` maps every x64 mnemonic the baseline compiler emits to an ALU op and a memory access; the switch is exhaustive per mnemonic, as in ADR-035, not per operand form. `call` and `jmp [mem]` model only the code fetch. Addresses come from `MachineState` (a stack slot is `rbp` plus an offset; a heap object is its illustrative compressed pointer). The caches are a deterministic LRU with 64-byte lines: L1 has 8 lines and L2 has 32; a miss in both counts as RAM. The board carries the Illustrative badge and never touches the Exact layer.

**Consequence.** The picture is repeatable and teaches locality, but its hit and miss counts are not Node's.

## ADR-065: Each example proves its transitions through a natives twin (Phase 7, D3)

**Context.** The Verified model badge on the hidden-class graph and the elements-kind lattice needs a check against real V8; two examples carry one.

**Decision.** `tests/conformance/internals/` holds natives twins for two of the ten catalog examples (hidden-classes-shapes and elements-kinds-lattice): the example source plus probe lines (`%HaveSameMap(x, y)`, a kind probe), recorded on real Node with `--allow-natives-syntax`. `tests/conformance/example-internals.test.ts` checks that each probe is answered by our timeline as V8 answered it.

**Consequence.** The twin expectations come only from `npm run conformance:record`. A mismatch is a model bug.

## ADR-066: The boards read refs only; the board choice is a stored toggle (Phase 7, D4 and D5)

**Context.** A seek or a play must not re-render React for a board that changes every tick.

**Decision.** Scene objects and SVG attributes are set from the `useHardwareFrame` ref (3D in `useFrame`, SVG through a painter). Name and role labels are `CanvasTexture` sprites drawn once; register values and the hit/miss cue are redrawn only when they change. There is no drei `Text` or `Html`. `HardwareView` shows the SVG board when WebGL is missing or lost, when the learner chose 2D, or, with no stored choice, when the viewport is under 768 px (checked at mount only); otherwise 3D, which the owner confirmed as the desktop default (Task 1). A stored `sl_hw_view` choice beats the viewport check (`useHwViewMode.ts`). The choice persists in `localStorage["sl_hw_view"]`, read and written in `try`/`catch`.

**Consequence.** Both boards render zero React commits on a seek or during play. The Hardware tab is visible at every width; under 768 px it shows the SVG board unless the learner stored a choice.

## ADR-067: The fps sampler is a rAF counter behind `?perf=1`, not r3f-perf (Phase 7, D6)

**Context.** The plan mounted `r3f-perf` under `?perf=1`. In Task 7, `r3f-perf` 7.2.3 injected an un-nonced `<style>` (stitches): two CSP violations, two page errors, and the canvas did not mount. It was uninstalled.

**Decision.** `features/hardware-3d/perf/PerfOverlay.tsx` starts a `requestAnimationFrame` counter only with `?perf=1` and exposes `window.__slHwFps()`, the average fps since mount. `e2e/hardware-perf.spec.ts` reads that accessor. It runs only with `PERF=1`, on a real GPU; Task 11 measured an average of 59.4 fps and a minimum of 59.0 (AMD GPU through ANGLE/D3D11).

**Consequence.** The figure is the display rAF rate since mount, not R3F's own frame count, so it can miss demand-loop skips. The CSP is unchanged. The headless long-task check in `e2e/playground-internals.spec.ts` pins a viewport where the canvas stays compact, because SwiftShader's synchronous canvas readback dominates frame time there; the full-size board is checked on a real GPU with `PERF=1`.

## ADR-068: Predict-first masking in the frame inspector (Phase 7, D7)

**Context.** ADR-061 withholds console and narration, so the frame inspector must not leak the string `console.log` is about to print.

**Decision.** Until Reveal or the last tick in interview mode, string values show `"…"` and object previews `{…}`. Smi, HeapNumber and Oddball values stay visible (the owner confirmed this in Task 1), because the current-line highlight leaks no more than they do. The values are Exact. The Smi tag and the tagged word shown beside them are Illustrative (ADR-039: `value << 1`, a 31-bit range, where pinned Node stores `value << 32`).

**Consequence.** The hardware board needs no masking, since it shows hex words and pointers. Mismatch: `FrameInspector.tsx` labels the whole panel `verified-model`, which is stricter than this classification; the tag and tagged-word cells should read Illustrative. It is recorded here and not changed in code (docs-only task).

## ADR-069: Derived-field rulings for the IC table, lattice and heap strip (Phase 7)

**Context.** The panels need fields the core does not store.

**Decision.** IC table truth is per row: `VERIFIED_SLOT_KINDS` (`core/runtime/ic/verifiedSlotKinds.ts`) holds exactly the three kinds `ic-states.cjs` asserts against `%DebugPrint`, `LoadProperty`, `LoadKeyed` and `SetNamedSloppy`, and gives Verified model; every other kind is Modeled. Its test lives in `tests/conformance/` because `core/` bans `node:fs`; the lattice's recorded-kind test is `tests/conformance/lattice-view.test.tsx`, because `features/` cannot import `tests/` helpers. The lattice counts the current kind as reachable. In the heap strip, `young.to` is the survived share of the last scavenge times the cell count.

**Consequence.** The heap strip stays Illustrative, and no source field was added to the core.

## ADR-070: The hardware trace shows one representative instruction per bytecode tick (Phase 7)

**Context.** A tick is one bytecode, but a `HardwareStep` holds one ALU op and one bus access, and the first instruction often has no bus traffic (a `mov` of an immediate), although a load such as `Ldar` starts with a memory read.

**Decision.** `traceHardware` picks, per bytecode tick, the first instruction with a bus access, else the first with an ALU op, else the first instruction.

**Consequence.** The board shows a representative step, not every instruction. The Illustrative badge covers this.

## ADR-071: Protocol caps, bus tokens and the 16-cell code strip (Phase 7)

**Context.** The plan named a `TICKS_MAX` that does not exist. The board also needed read and write told apart, and somewhere for fetch pulses to land.

**Decision.** The `hardware` array is capped by `LIMITS.ticks` (5000, the plan's value). New tokens `--bus-read` and `--bus-write` (blue and pink, in both themes) are in `app/globals.css` and in `tests/tooling/contrast.test.ts` at 4.5:1; direction is also shown by arrowheads and a text label. The RAM is one `InstancedMesh` of 208 cells: stack, young and old at 64 each, plus a 16-cell code strip.

**Consequence.** Hit and miss, and read and write, are never colour-only.

## ADR-072: The short-height and 375 px internals layout is not built (Phase 7, tracked follow-up)

**Context.** The shape brief (`docs/design/internals-hardware-shape.md` §3 and §10) asks for column sub-tabs under 300 px of panel height and a 375 px accordion with a drag hint. Task 12 was a fix batch, and the layout belongs to Tasks 5, 6 and 10, which did not build it.

**Decision.** Panels stack and scroll at short heights and at 375 px.

**Consequence.** Tracked follow-up (mandatory): build the sub-tab, accordion and drag-hint layout for short panels. Until then a short panel is a scrolling stack. Also not built: changed-this-tick outlines and Map-chip hover sync with the graph.

**RAM layout (a second deviation).** The brief (§10) stacks the RAM regions top to bottom (code, stack, young from|to, old). `features/hardware-3d/board/layout.ts` instead lays code, stack, young and old out in one row of grids in the wide composition. It stays; reconcile the brief or the layout when the follow-up above is built.

## ADR-073: SvgBoard lives in `features/hardware-3d/SvgBoard.tsx` (Phase 7)

**Context.** The plan placed it at `svg/SvgBoard.tsx`. Task 7 put the lazy placeholder at `features/hardware-3d/SvgBoard.tsx`, and `HardwareView` and three test mocks import `./SvgBoard`.

**Decision.** It stays there. Its helpers (`boardPainter.ts`, `coords.ts`) are in `svg/`.

**Consequence.** Only the path differs from the plan.

## ADR-074: ADR-060 is closed and ADR-062 stands (Phase 7)

**Context.** ADR-060 deferred the 375 px "More playback" popover. ADR-062 left open whether the budget counts the `noModule` chunk.

**Decision.** Task 10 (commit `98aecbe`) added `MorePlayback.tsx`, a Radix Popover loaded only once a phone-width bar renders, so ADR-060 is closed. The owner answered in Task 1 (2026-10-26): the budget is the modern-browser first load, 214.2 KB gz against 250 KB, and the `noModule` total (252.8 KB) is recorded for information. `three`, R3F, drei and the internals views live in lazy chunks; Task 7 measured 214.0 KB (before Task 10).

**Consequence.** Phase 7 adds 0.8 KB to the modern-browser first load, not 0 KB: 214.0 KB at Task 7 (`ae70e31`, 219,100 B) and 214.8 KB at the end of Phase 7 (219,959 B), against the 250 KB budget. Most of it, +0.66 KB, is Task 10's lazy "More playback" boundary: the eager phone-width switch, the `React.lazy` loader stub and Turbopack's re-partitioning of the page chunks into four (the Popper and Tooltip modules it shares with the popover chunk), which alone costs about 0.25 KB of gzip efficiency. The rest is the store's `asmSyntax` (+76 B), Task 11 and 12 glue (+65 B) and the narrow badge (+39 B). Popover, `three`, R3F, drei and the internals views stay in lazy chunks. The `noModule` total is 253.4 KB, for information. Phase 9 enforces the modern-browser figure.
