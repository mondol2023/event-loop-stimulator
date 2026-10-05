@AGENTS.md

# Silicon Loop: project notes

A V8 engine and event-loop visualizer. The spec is `PROMPT.md`: run one phase per session and stop for review after each. See also `PRODUCT.md` and, under `docs/`, `DECISIONS.md` (deviations), `ARCHITECTURE.md`, `FIDELITY.md` and `TARGET.md` (the pinned Node/V8).

## Commands

| Command | What |
|---|---|
| `npm run dev` | Next dev server (Turbopack) |
| `npm run lint` | ESLint, incl. layer boundaries + code-execution bans |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| `npm test` | Vitest (unit, golden, property, recorded conformance). Node env; UI tests add `// @vitest-environment jsdom` |
| `npm run conformance` | Conformance suite in `tests/conformance/` |
| `npm run conformance:record` | Re-record `*.expected.json` on real Node; refuses unless the runtime equals `docs/TARGET.md` |
| `npm run seed` | Upsert Role docs and indexes; promotes `ADMIN_BOOTSTRAP_EMAIL` only if that user already registered |
| `npm run e2e` | Playwright (builds + starts on :3100) |
| `npm run build` | Production build, then `scripts/check-build.mts` (no eval/child_process/vm in the output) |
| `docker compose up -d` | Mongo replica set `rs0` (add `--profile redis` for Redis) |

A phase is done only when lint, typecheck, test and build all pass, with the output shown. Core phases also need `npm run conformance`.

## Invariant: never execute user code

- **Never execute it.** User source is only parsed (`@babel/parser`) and interpreted by our spec model in `core/`.
- **Banned APIs.** Never use `eval`, `new Function`/`Function()`, `ShadowRealm`, `vm`/`node:vm` or `child_process`. ESLint bans them repo-wide; never disable that rule.
- **The one exception.** `scripts/conformance/` and `tests/conformance/` may use `child_process`, and only to run repo-owned or generated fixture programs on real node.
- **Zod.** Import it only from `@/core/shared/zod`, which sets `jitless` so that Zod never compiles parsers with `new Function`.

## Conformance expectations come only from real Node

- `*.expected.json` is written only by `npm run conformance:record` on the pinned runtime.
- Never hand-edit an expectation to make a test pass. A mismatch is a bug in our model (use `superpowers:systematic-debugging`).
- Bumping the target is deliberate: update `docs/TARGET.md`, re-record, review the diffs, and add an ADR.

## Directory dependency rule (enforced by ESLint `no-restricted-imports`)

- `core/`: pure TS. It imports only `core/` plus pure npm libraries. No React/Next, Node built-ins, DOM, I/O, clock or randomness. The same input gives byte-identical output.
- `features/`: imports `core/`, `components/` and `lib/`. It reaches the server **only** via Server Actions in `server/actions/*`.
- `app/`: routing only. It composes `features/` and `server/`.
- `server/`: every file starts with `import "server-only"`.
- Nothing imports `app/` (except `tests/integration` importing `app/api/**` handlers), `tests/` or `scripts/`. Only `server/repositories/**` and `server/db/**` import Mongoose models.

Proof: `tests/tooling/eslint-boundaries.test.ts`. Extend it whenever you change a rule.

## Conventions

- **Next.js 16.** Read `node_modules/next/dist/docs/` before using an API. Request interception is `proxy.ts`, not middleware. Use only async `params`/`searchParams`/`cookies()`/`headers()`.
- **Env.** `server/env.ts` validates it on boot via `instrumentation.ts`. Use `getEnv()`; never read `process.env` in server code.
- **Types.** `.strict()` Zod objects at every boundary. Use `Result<T, Diagnostic[]>` in `core/`, and name things after V8 and the spec (`BytecodeArray`, `FeedbackVector`).
- **Styling.**
  - Tailwind v4 tokens live in `app/globals.css`. Dark is the default (`<html class="dark">`).
  - Use semantic tokens (`bg-panel`, `text-microtask`, `text-warning`) and never raw hex.
  - `tests/tooling/contrast.test.ts` guards the 4.5:1 contrast floor.
- **Animation.** `motion` only (`motion/react`), with no GSAP.
- **Icons.** Lucide only.
