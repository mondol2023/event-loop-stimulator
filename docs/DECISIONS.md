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
