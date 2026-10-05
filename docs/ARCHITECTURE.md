# Architecture

Silicon Loop shows how V8 runs a small JS/TS program. A program goes Source → AST & scopes → Ignition bytecode → baseline machine code. The app then simulates it tick by tick across the event loop, V8's internals and the hardware.

**User code is never executed** by any real engine. It is parsed and interpreted by our own spec model, and its observable results must equal the pinned Node/V8 ([`TARGET.md`](TARGET.md), [`FIDELITY.md`](FIDELITY.md)).

## One pipeline, modeled on V8's

```
source ─▶ type-strip (TS only, position-preserving) ─▶ Scanner/Parser ─▶ ESTree AST
       ─▶ Scope analysis (hoisting, TDZ, context allocation) ─▶ subset validator
       ─▶ BytecodeGenerator ─▶ BytecodeArray per function
              (+ constant pool, feedback slot layout, SourcePositionTable)
                       │
        ┌──────────────┼───────────────────────────┬────────────────────────────┐
        ▼              ▼                           ▼                            ▼
  Bytecode pane   IgnitionInterpreter       BaselineCompiler (Sparkplug-style) ─▶ X64Encoder
  (listing)       (spec model + V8 heap     per-bytecode asm templates           bytes + spans
                   model + Node loop)       asm + spans
                       │                           │
                       ▼                           ▼
                   Timeline  ◀── every Tick carries (functionId, bytecodeOffset) ──▶ SourcePositionTable
```

The bytecode is the single source of truth, as it is in V8:

- The interpreter executes the same `BytecodeArray`s that the panes display.
- The baseline compiler is a per-bytecode template translation, as Sparkplug is, so the asm pane can't drift from the bytecode.
- Every mapping in the app (AST node, asm span, byte span, tick) goes through `(functionId, bytecodeOffset)`.

## Directory layout

```
app/                 routing only: thin pages that compose features (+ api/ route handlers)
proxy.ts             optimistic session redirect, security headers, request id
instrumentation.ts   validates the environment on server boot
core/                PURE TS, runs in browser, worker and server:
                     frontend/ bytecode/ baseline/ runtime/ interpreter/ host/ timeline/ shared/
features/            React feature modules (components/, hooks/, store/), incl. the pipeline worker
server/              `import "server-only"`: env, db, repositories, auth, security, audit, actions
components/ui/       shadcn output
lib/                 small shared UI helpers (cn)
tests/conformance/   fixtures + *.expected.json recorded on real Node, generator, runner
tests/tooling/       proofs for the lint rules, design tokens and build check
scripts/conformance/ the ONLY code that spawns real node (pinned, sandboxed)
scripts/             build checks
vendor/test262/      in-subset tests only (Phase 2)
docs/                ARCHITECTURE, DECISIONS, FIDELITY, TARGET, SUPPORTED_SUBSET
e2e/                 Playwright
```

## Dependency rule

| Layer | May import |
|---|---|
| `core/` | `core/` and pure npm libraries ([ADR-001](DECISIONS.md)). No React/Next, Node built-ins, DOM, I/O, clock or randomness |
| `features/` | `core/`, `components/`, `lib/`; the server **only** via `server/actions/*` ([ADR-002](DECISIONS.md)) |
| `app/` | `features/`, `server/`, `components/`, `lib/` |
| `server/`, `components/`, `lib/` | anything except `app/`, `tests/`, `scripts/` |
| `tests/`, `scripts/` | each other. Only the `conformance/` directories may use `child_process` |

Nothing imports `app/` (integration tests may import `app/api/**` handlers, [ADR-017](DECISIONS.md)), `tests/` or `scripts/`. Only `server/repositories/**` and `server/db/**` import Mongoose models. Zod is imported only through `core/shared/zod.ts`, which turns off Zod's `new Function` JIT ([ADR-007](DECISIONS.md)).

## Code-execution bans, in three layers

1. **Source.** ESLint bans `eval`, the `Function` constructor, `ShadowRealm`, `vm` and `child_process` across the repo. The only exception is `child_process`, in `scripts/conformance/` and `tests/conformance/`.
2. **Build.** `npm run build` ends with `scripts/check-build.mts`. It fails if `eval(`, `child_process`, `vm` or `ShadowRealm` appears in `.next/static` or `.next/server`.
3. **Browser.** A nonce-based CSP without `'unsafe-eval'` in production ([ADR-012](DECISIONS.md)).

`tests/tooling/eslint-boundaries.test.ts` and `tests/tooling/build-bans.test.ts` prove the first two.

## Runtime boundaries

- **Browser.** The UI renders. Compile and simulate run in a Web Worker (`features/playground/worker/`), with Zod-validated messages.
- **Server.** Requests pass four layers, each of which can only reject:
  1. `proxy.ts`: mints the CSP nonce and `x-request-id`, sets the security headers, and redirects `/dashboard` and `/admin` visitors who have no session cookie. This is optimistic (no database, no unsealing) and is never the security boundary.
  2. DAL (`server/auth/dal.ts`): the real authorization point. `getCurrentUser()` re-reads the user on every request and returns null unless the account is active and the cookie's `sessionVersion` matches. `authorize(permission)` yields 401/403 and audits `rbac.denied`.
  3. Services (`authService`, `userAdmin`): the rules, rate limits and audit rows.
  4. Repositories: the only importers of Mongoose models. They return plain domain types and validate every id before a query.

  Server Actions and Route Handlers stay thin: Zod, authorize, rate limit, service, audit.
  - `POST /api/compile` runs, in order: origin + signed CSRF -> caller -> rate limit -> bounded body read -> Zod -> `worker_threads` pool (64 MB, 2 s). Phase 1 runs a stub worker; the pool guards resources and is not a sandbox for user code.
  - Auth uses iron-session and argon2id; a password change, ban or role change bumps `sessionVersion`, which revokes every older session.
  - Data lives in MongoDB, as a replica set so transactions work; the connection opens on first use.
  - Rate limits use Redis, or memory in dev. Settings come from a Mongo `Setting` doc (30 s cache, defaults on failure).
  - Audit is fire-and-forget through a bounded queue; rows hold `codeHash`, never code, and expire after 90 days.
- **Boot.** `instrumentation.ts` validates the environment (`server/env.ts`) before the server takes requests.
- **Conformance.** Expectations come only from real Node on the pinned target, via `npm run conformance:record`. `npm test` compares against the recorded files, so CI doesn't need the pinned Node.
