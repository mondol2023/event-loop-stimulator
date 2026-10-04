# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Create Next App scaffold into a strictly typed, lint-enforced, tested foundation that the later phases build on.

**Architecture:** Config and tooling only. No domain code yet. The dependency rule from PROMPT.md §5.2 is enforced by ESLint and proven by a Vitest test that lints sample source through the ESLint Node API. Env validation is a pure Zod parser in `server/env.ts`. `/playground` is a static placeholder.

**Tech Stack:** Next.js 16.3.8 (Turbopack), React 19.2, TypeScript 5, Tailwind v4 + shadcn, Vitest 5, Playwright 1.63, Zod 4.

**Spec:** `PROMPT.md` §3, §4, §5.2, §7.1 and §8 Phase 0.

## Global Constraints

- tsconfig: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. No `any`.
- `core/` imports only `core/`. `features/` imports `core/` and `components/`. `app/` imports `features/` and `server/`. Nothing imports `app/`.
- Banned repo-wide: `eval`, `new Function`, `node:vm` / `vm`, `child_process` / `node:child_process`.
- Every `server/` file starts with `import "server-only"`.
- Env: `MONGODB_URI`, `SESSION_SECRET` (≥32 chars), optional `REDIS_URL`, `ADMIN_BOOTSTRAP_EMAIL`.
- Fonts: IBM Plex Sans (UI) and JetBrains Mono (code), both through `next/font`.
- Colors are semantic tokens. Dark first, light also, ≥4.5:1 text contrast in both. Accents: green = primary/run/current tick, violet = microtask, amber = macrotask, cyan = Web API, red = error.
- One animation system: `motion`. No `framer-motion`, `gsap` or `@gsap/react`.

## Review Focus

1. A `core/` file importing `server/` through a **relative** path (`../server/env`) rather than the `@/` alias must also fail lint. Test: `eslint-boundaries.test.ts` covers both forms.
2. `features/` importing `server/` directly (not via a Server Action) must fail lint. Test case included.
3. `SESSION_SECRET` of exactly 31 chars fails and 32 passes. Test: `env.test.ts` boundary case.
4. An empty-string `REDIS_URL` (common in copied `.env` files) is treated as unset, not as an invalid URL. Test case in `env.test.ts`.
5. `new Function(...)` and `eval(...)` written inside `app/` (not only `core/`) are rejected. Test case in `eslint-boundaries.test.ts`.

---

### Task 1: Dependencies and scripts

**Files:** Modify `package.json`, `package-lock.json`.

- [ ] Uninstall `framer-motion gsap @gsap/react playwright`.
- [ ] Install runtime: `motion zod zustand mongoose iron-session argon2 ioredis nanoid @uiw/react-codemirror @codemirror/lang-javascript @babel/parser server-only`.
- [ ] Install dev: `vitest @vitejs/plugin-react vite-tsconfig-paths jsdom @testing-library/react @testing-library/dom fast-check @playwright/test @axe-core/playwright mongodb-memory-server`.
- [ ] Scripts: `"typecheck": "next typegen && tsc --noEmit"`, `"test": "vitest run"`, `"test:watch": "vitest"`, `"e2e": "playwright test"`, `"lint": "eslint ."`.

### Task 2: Strict TypeScript

**Files:** Modify `tsconfig.json` (target `ES2022` so `bigint` literals work later; add the four flags).
- [ ] Run `npm run typecheck`. Expected: exit 0.

### Task 3: Vitest + Playwright

**Files:** Create `vitest.config.mts`, `playwright.config.ts`, `e2e/playground.spec.ts`.
- Vitest: `tsconfigPaths()`, `react()`, environment `node` by default (jsdom opt-in per file), `include: ["**/*.test.{ts,tsx}"]`, exclude `e2e/**`, alias `server-only` to an empty module so server code is unit-testable.
- Playwright: `webServer` runs `npm run build && npm run start` on port 3000 (`reuseExistingServer: !process.env.CI`), chromium project only.
- e2e test `playground renders placeholder`: `GET /playground` → heading "Playground" visible.

### Task 4: ESLint dependency rule + bans (TDD)

**Files:** Modify `eslint.config.mjs`. Test: `tests/tooling/eslint-boundaries.test.ts`.
- [ ] Failing tests using `new ESLint({ cwd })` and `lintText(code, { filePath })`:
  - `core/x.ts` importing `@/server/env` → error; importing `../server/env` → error; importing `react` → error; importing `@/core/shared/result` → no error.
  - `features/x/y.ts` importing `@/server/env` → error; `@/app/page` → error; `@/core/...` → ok.
  - `server/x.ts` importing `@/app/layout` → error.
  - `app/x.tsx` containing `eval("1")` → error; `new Function("return 1")` → error; `import vm from "node:vm"` → error; `import { exec } from "child_process"` → error.
- [ ] Implement with per-directory `no-restricted-imports` `patterns` blocks (group globs for `@/server/**`, `**/server/**`, `@/app/**`, `**/app/**`, plus `react*`, `next*`, `node:*` for `core/`) and a repo-wide `no-restricted-syntax` (`CallExpression[callee.name='eval']`, `NewExpression[callee.name='Function']`) and `no-restricted-imports` paths for `vm`, `node:vm`, `child_process`, `node:child_process`.
- [ ] `npm test` passes; `npm run lint` passes.

### Task 5: Environment (TDD)

**Files:** Create `server/env.ts`, `server/env.test.ts`, `.env.example`, `docker-compose.yml`, `instrumentation.ts` (only if the Next 16 docs confirm `register()` runs at server boot and not during build).
- **Produces:** `parseEnv(raw: Record<string, string | undefined>): Env` (throws an `Error` listing every invalid key, never echoing values), `getEnv(): Env` (memoized over `process.env`), `type Env = { MONGODB_URI: string; SESSION_SECRET: string; REDIS_URL?: string; ADMIN_BOOTSTRAP_EMAIL?: string }`.
- Tests: valid input parses; missing `MONGODB_URI` throws naming the key; 31-char secret throws, 32 passes; empty `REDIS_URL` → `undefined`; error message does not contain the secret value.
- docker-compose: `mongo:8` with `--replSet rs0` and a healthcheck that runs `rs.initiate()` once; `redis:7` under profile `redis`.

### Task 6: shadcn, tokens, fonts, placeholder routes

**Files:** `components.json`, `lib/utils.ts`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `app/playground/page.tsx`.
- [ ] `npx shadcn@latest init` (Tailwind v4, neutral base). Then replace the generated palette with the §7.1 tokens: `--background`, `--panel`, `--foreground`, `--muted-foreground`, `--border`, `--primary` (green), `--microtask` (violet), `--macrotask` (amber), `--webapi` (cyan), `--destructive` (red), `--ring`. Dark is the default (`:root`), and light lives under `.light` / `[data-theme=light]`.
- [ ] Layout uses IBM Plex Sans + JetBrains Mono (`next/font/google`, variables `--font-sans` and `--font-mono`).
- [ ] `/playground` is a Server Component with an `h1` "Playground" and a short note that the IDE arrives in Phase 5. `/` is replaced with a minimal landing linking to `/playground`.

### Task 7: Design context

- [ ] Run `impeccable init` with the human → `PRODUCT.md` (audience: CS students, bootcamp learners, interviewees; goals; tone; constraints).

### Task 8: Docs, verification, review, commit

- [ ] `CLAUDE.md` project section (<60 lines): commands, dependency rule, never-execute-user-code invariant.
- [ ] `docs/ARCHITECTURE.md` (§5 diagram and layout), `docs/DECISIONS.md` (ADRs for any deviations).
- [ ] Run lint, typecheck, test, build and e2e in parallel where possible; all exit 0.
- [ ] `/code-review` on the diff; fix agreed findings.
- [ ] Commit: `chore: phase 0 foundation`.

---

## Addendum: PROMPT.md revision (V8 fidelity contract)

PROMPT.md was revised mid-phase: it adds §3 (V8 fidelity contract) and renumbers the stack, architecture and UI sections to §5, §6 and §8. Phase 0 gains the tasks below, each test-first:

### Task 9: Conformance boundary in ESLint
- Modify `eslint.config.mjs`:
  - ban `ShadowRealm`
  - ban imports of `tests/` and `scripts/` from product code
  - allow `child_process` only under `scripts/conformance/` and `tests/conformance/` (ADR-008)
- Test `tests/tooling/eslint-boundaries.test.ts`:
  - `child_process` in `core/` is rejected
  - `eval`/`vm` stay banned in the conformance directories
  - `child_process` is allowed there

### Task 10: Pinned target
- Create `docs/TARGET.md` (Node 24.19.0, V8 13.6.233.17-node.51).
- Create `scripts/conformance/target.mts` with `parseTarget`, `readTarget` and `checkPinnedRuntime`.
- Create `scripts/conformance/record.mts`, which runs the pin guard only.
- Add the `conformance` and `conformance:record` scripts.
- Test: `tests/conformance/target.test.ts`.

### Task 11: Zod without code generation
- `core/shared/zod.ts` sets `jitless`, and ESLint routes all `zod` imports through it (ADR-007).
- Test `core/shared/zod.test.ts`: parsing never constructs a `Function`.

### Task 12: Build check
- `scripts/check-build.mts` runs after `next build` (ADR-008).
- Test: `tests/tooling/build-bans.test.ts`.
- Verify with a negative probe file in `.next/static`, which must fail with exit 1.

### Task 13: Docs and tokens
- `docs/FIDELITY.md` skeleton (the §3.2 table).
- `docs/ARCHITECTURE.md` with the §6.1 diagram.
- CLAUDE.md conformance rule, kept under 60 lines.
- PRODUCT.md and landing copy reworded for the V8 pipeline.
- `--warning` (fidelity warning, yellow) token, with contrast pairs in `tests/tooling/contrast.test.ts`.
