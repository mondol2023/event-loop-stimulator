# Phase 5: Client State Broker & Worker (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile and simulate in a browser Web Worker. Hold the result in one Zustand store with the timeline kept outside React. Expose selector hooks, a rAF playback clock and keyboard shortcuts, so that Phase 6's UI only has to render.

**Architecture:** `features/playground/` holds four parts:
- `worker/`: a Zod-validated protocol, a pure request handler and the worker entry.
- `store/`: a vanilla Zustand store with four slices, and a per-store timeline holder outside the state.
- `hooks/`: the only read path, through `useShallow` or an equality function.
- `playback/` and `keyboard/`: the clock and the shortcuts.

The worker sends only plain DTOs: the materialized views, a `LineIndex`, the baseline code and the serialized timeline. The main thread never holds a `BytecodeProgram`. Two new pure helpers go in `core/`: `core/views/lineIndex.ts` and `core/timeline/boundaries.ts`.

**Tech Stack:** Next.js 16.3.8 (Turbopack), React 19.2.8, Zustand 5.0.15 (`createStore`, `subscribeWithSelector`, `useShallow`, `zustand/traditional`'s `useStoreWithEqualityFn`), Zod 4 via `@/core/shared/zod`, Vitest 5 + jsdom + `@testing-library/react` 16, Playwright.

**Spec:** `PROMPT.md` §7.6 (the main spec), §2 principles 1, 5 and 9, §3.2, §7.5 (Tick, timeline storage) and §9 Phase 5. ADR-030, ADR-031, ADR-032, ADR-033 and ADR-038 constrain it and **win where they conflict**. Read `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md` (the `new Worker()` section) and `01-app/02-guides/content-security-policy.md` before Task 1.

## Context

Phases 0–4 are done. Phase 4 ends at `170a8a4` (`test(phase4): record x64 encoding goldens (clang MC fallback)`). Phase 5 reads `BaselineCode`, `machineStateAt` and `views.asm`/`binary`, and never edits `core/baseline/` or the asm scripts and tests.

The `phase-4` working tree still has 13 modified files that are not Phase 5's: docs, `core/host/nondeterminism*`, and the differential generator and its tests. Task 0 settles them before branching.

**Done when (PROMPT §9):**
- Render-count tests show that changing `index` re-renders only the subscribed components.
- The 3D hook causes zero renders during playback.
- Stale jobs are dropped.

## Verified facts (probed 2026-10-24 in this repo; do not re-derive)

- **Nothing exists yet.** There is no `features/` directory. `app/playground/page.tsx` is a Server Component placeholder.
- **The timeline:**
  - `simulate(source, lang, opts)` compiles internally.
  - The worker must instead call `new CompilationManager().compile(source, lang)` once and then `new SimulationEngine().run(compiled.program, { tiering: new TieringModel() })`. That is one compile for both the views and the run.
- **`TimelineStore`** (`core/timeline/TimelineStore.ts`) provides:
  - `fromTicks(ticks)`, `serialize(): string`, `deserialize(json)`, `at(i)`, `length`.
  - `deserialize` validates the shape with `checkShape` and throws `Error("not a serialized timeline: …")`. ADR-030 defines the 20 MB budget as the serialized UTF-8 length "that crosses the worker boundary".
  - Unchanged sub-objects are shared by reference between `at(i)` and `at(i+1)`. Hooks use this: an unchanged `callStack` is `Object.is`-equal across ticks.
- **The Tick** (`core/timeline/Tick.ts`) is `DeepReadonly` plain data and contains no `bigint`. `machine` is not on it: `machineStateAt(tick, baseline: BaselineCode)` derives it (ADR-033) and returns `bigint` registers on the main thread.
- **Lazy views.** `CompilationResult.views.asm` and `.binary` are **lazy getters**. The worker must read them before posting, because structured clone invokes getters, but reading them explicitly keeps the cost inside the worker. `BaselineCode` is plain data.
- **Source mapping.** `positionsForSourceRange` and `sourceRangeForPos` (`core/views/types.ts`) need a `BytecodeProgram`, so the main thread needs a precomputed plain index instead.
- **CSP** (`server/security/headers.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'` and `worker-src 'self' blob:`. Production has no `'unsafe-eval'`.
- **Worker bundling.** Turbopack's docs list `new Worker()` among the expressions that take magic comments. On the server, ADR-032 found that Turbopack copies a TypeScript **`worker_threads`** entry unbundled. Browser-worker bundling is **unverified**, which makes it Task 1's spike.
- **Packages.** `zustand/traditional` exists. `use-sync-external-store` is present only transitively, so Task 5 adds it as a direct dependency.
- **Test environment.** Vitest runs in the Node environment, and UI tests opt into jsdom with `// @vitest-environment jsdom`. jsdom has no `Worker`, so tests use an in-process fake transport.

## Decisions (become ADR-039+, flagged for owner review)

- **D1: The timeline crosses as the serialized string** (follows ADR-030).
  - The worker posts `TimelineStore.serialize()`, and the main thread calls `TimelineStore.deserialize`.
  - Zod validates the message envelope, with `timeline: z.string().max(TIMELINE_MAX_CHARS)` where `TIMELINE_MAX_CHARS = 20 * 1024 * 1024`.
  - The tick contents are validated by `checkShape`, not by Zod, because a deep Zod parse of 5,000 ticks would cost more than the run.
- **D2: Two responses per job, `compiled` then `simulated`.**
  - The panes fill before the run finishes.
  - Applying a new job's `compiled` **clears the old timeline in the same `setState`**, so old ticks never pair with the new line index.
- **D3: A superseded in-flight job terminates the worker.**
  - When a new job is dispatched while another is running, the client calls `worker.terminate()` and spawns a fresh worker.
  - A long simulation would otherwise block the new one, and an old result can never arrive.
  - The `jobId` check still guards every message.
- **D4: The main thread gets DTOs only:** `diagnostics`, `strippedJs`, the four materialized views, a `LineIndex`, `baselines: BaselineCode[]` (indexed by `FunctionId`), the boundaries and the run summary.
- **D5: Playback rate.**
  - 1× = **4 ticks/s**, with speeds `[0.25, 0.5, 1, 2, 4, 8]`.
  - Each frame's delta is clamped to **250 ms**, so a backgrounded tab does not jump.
  - Playback stops at the last tick.
  - The owner may change the base rate. It is one constant.
- **D6: The worker attaches a `TieringModel`, and natives and test262 stay unreachable.** The request schema is `.strict()` with no `natives` or `host` key (ADR-026, ADR-031).
- **D7: One store per `PlaygroundProvider`, not a module singleton.**
  - The timeline lives in a `WeakMap<PlaygroundStore, TimelineStore>` holder module, outside React and outside Zustand state. This is §7.6's "module ref", scoped per store so that tests and future embeds are isolated.
  - The store state carries only `timelineVersion: number`, which bumps on each swap so that selectors re-run.

## Global Constraints

- **Never execute user code.**
  - The worker only imports `core/` and calls `compile`/`run`.
  - No `eval`, `new Function`, `vm`, `ShadowRealm`, blob or data-URL scripts, or dynamic `import()` of user text. The worker URL is a repo file, never a blob built from source.
  - `npm run build` runs `check-build`, which must stay green with the worker chunk included.
- **Layers.** `core/` stays pure: no React, DOM, clock or randomness. The `core/` additions are pure functions with Node-environment tests. `features/` imports `core/`, `components/` and `lib/` only, and nothing in this phase touches `server/`.
- **Zod** only via `@/core/shared/zod`, with `.strict()` on every object schema in the protocol.
- **Debounce 400 ms.** Every response carries `jobId`, and a response whose `jobId` is not the latest dispatched one is dropped.
- **Store slices** are exactly `editor { source, lang, diagnostics }`, `compile { … }`, `playback { index, isPlaying, speed, length }` and `hover { pane, line }`. The timeline never enters React state or Zustand state.
- **Read path.** Selector hooks are the only read path for components: `useCallStack`, `useQueues`, `useLoopPhase`, `useConsole`, `useV8State`, `useNarration`, `useFidelityWarnings` (all `useShallow`), `useHighlightedLines(pane)` and `useHardwareFrame()`.
- **Per-frame work** never goes through React reconciliation for unsubscribed components. `useHardwareFrame` causes **zero** renders.
- **Keys:**

  | Key | Action |
  |---|---|
  | `Space` | Play/pause |
  | `←` / `→` | Step |
  | `Shift+←` / `Shift+→` | Previous/next boundary |
  | `Home` / `End` | First/last tick |

- **TypeScript.** Strict flags, no `any`, branded `FunctionId`, and exhaustive `switch` with `never` on message types and panes.
- **Comments:** one line, giving the *why* or the doc/ADR they rely on. Tests only prove a done-when item or a Review Focus risk: no snapshot tests and no tests of trivial setters.
- **Commits.** Commit per task with Conventional Commits, ending with the `Co-Authored-By` trailer from the session's attribution reminder.

## Review Focus

1. **The user types while a long simulation runs.** The old job's `simulated` result must never land, even if it is already in flight, and its ticks must never pair with the new views → Task 4 (terminate + `jobId`) and Task 5 (`compiled` clears the timeline).
2. **The tab is backgrounded mid-play** (a rAF gap of 30 s). On return, playback advances by at most one clamped frame, not 120 ticks → Task 8.
3. **Space or an arrow key pressed while typing in the editor** (a `textarea` or `contenteditable`) or with Ctrl/Meta/Alt held. It types or moves the caret, and never toggles playback → Task 9.
4. **The worker crashes or posts garbage** (`error` event, `messageerror`, a schema failure, a `deserialize` throw). The status becomes `failed` with a message, the UI is never stuck in `simulating`, and the next request spawns a fresh worker → Tasks 3 and 4.
5. **An empty or shorter timeline:**
   - a refused program has 0 ticks, and every hook returns its empty default without calling `at()`
   - a new timeline shorter than the current `index` resets it to 0
   - `End`, step and play at length 0 do nothing

   → Tasks 5 and 6.

---

## File Structure

```
core/views/lineIndex.ts (+test)          LineIndex DTO: pane line ↔ BytecodePos, source lines included (pure)
core/timeline/boundaries.ts (+test)      phase/job boundary indices of a tick list (pure)
features/playground/worker/protocol.ts   Zod request/response schemas + types
features/playground/worker/handleRequest.ts (+test)  pure: request → responses (compile, run, DTOs)
features/playground/worker/pipeline.worker.ts        entry: onmessage → validate → handleRequest → postMessage
features/playground/worker/PipelineClient.ts (+test) debounce, jobId, terminate-on-supersede, crash handling
features/playground/store/{playgroundStore,timelineHolder}.ts (+test)
features/playground/store/PlaygroundProvider.tsx     context + client + clock + shortcuts wiring
features/playground/hooks/{useTickSelectors,useHighlightedLines,useHardwareFrame}.ts (+tests)
features/playground/playback/PlaybackClock.ts (+test)
features/playground/keyboard/{shortcuts.ts,useShortcuts.ts} (+test)
features/playground/test/{fakeWorker,fixtureTimeline}.ts   test helpers (fake transport, real timeline from a fixture)
app/playground/page.tsx                  (modify) mounts a minimal client shell (Phase 6 replaces it)
e2e/playground-worker.spec.ts            worker runs under next start, CSP clean
docs/{DECISIONS,ARCHITECTURE,FIDELITY}.md, PROMPT.md status line
```

## Model and effort per task

The main session is the **orchestrator**: it dispatches each task to a fresh subagent and passes the `model` and `effort` below **explicitly**. A task never runs on the main session's model by default. After each task, a review subagent runs with the **Review** model. If the review finds problems, the same implementer model fixes them once. A task that fails twice escalates to **Opus, high**. Any conformance mismatch: stop and dispatch **Opus, high** with `superpowers:systematic-debugging`.

| # | Task | Run with | Review with | Why |
|---|---|---|---|---|
| 0 | Branch + plan commit | Haiku, low | none | Git only |
| 1 | Browser-worker bundling spike | **Sonnet, high** | **Opus, medium** | Unverified bundler behavior, CSP and the code-execution ban meet here |
| 2 | `lineIndex` + `boundaries` (core) | Sonnet, medium | Sonnet, low | Small pure functions, real-fixture tests |
| 3 | Protocol, handler, worker entry | **Sonnet, high** | **Opus, medium** | Trust boundary; natives/test262 must stay unreachable |
| 4 | `PipelineClient` | **Sonnet, high** | Sonnet, medium | Races: debounce, supersede, crash |
| 5 | Store + timeline holder | **Sonnet, high** | **Opus, medium** | Sets every later contract; the D2 atomic swap |
| 6 | Selector hooks + render-count tests | **Sonnet, high** | **Opus, medium** | The main done-when item; equality subtleties |
| 7 | `useHardwareFrame` (zero renders) | Sonnet, medium | Sonnet, low | Small; one decisive test |
| 8 | `PlaybackClock` | Sonnet, medium | Sonnet, low | Injectable rAF; arithmetic |
| 9 | Keyboard shortcuts | Sonnet, medium | Haiku, low | Pure mapping + one hook |
| 10 | Provider, page wiring, e2e smoke | Sonnet, medium | Sonnet, medium | Integration under `next start` |
| 11 | Docs: ADR-039+, ARCHITECTURE, FIDELITY, PROMPT | Sonnet, low | Haiku, low | Follows the existing ADR style |
| 12 | Full verification run | Haiku, low | none | Run and report only |
| 13 | Final bug and security review | **Opus, medium** | none | Standing rule (final Opus review) |
| 14 | Fix agreed findings, re-verify, report | Sonnet, medium | Haiku, low | Fixes are already specified |
| any | Debugging a failing test or mismatch | **Opus, high** | — | Root cause first |

**Order.** Tasks run in order, with three exceptions. Task 2 may run in parallel with Task 1. Tasks 8 and 9 may run in parallel with Tasks 6–7, because they depend only on Task 5.

---

### Task 0: Branch and plan commit
**Run with:** Haiku, low. **Review:** none.

- [ ] **Precondition (the owner's call).** The 13 modified files left on `phase-4` (see Context) are committed on `phase-4` or explicitly kept out. Ask the owner which, and never stash or discard them.
- [ ] `git checkout -b phase-5` from `phase-4`, then commit only this file: `docs: phase 5 plan`.

**Done when:** `git log -1 --oneline` shows `docs: phase 5 plan` on `phase-5`, and `git status --short` shows nothing Phase 5 did not create.

---

### Task 1: Browser-worker bundling spike
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create: `features/playground/worker/pipeline.worker.ts` (spike body: imports `CompilationManager`, compiles a constant program and posts `diagnostics.length`), `app/playground/spike/page.tsx` plus a `"use client"` component that creates the worker and renders the answer (both **deleted at the end of the task**)
- Modify (only if path 2 ships): `scripts/build-worker.mts`, `package.json`

**Two paths, tried in order:**
1. `new Worker(new URL("./pipeline.worker.ts", import.meta.url), { type: "module" })` from the client component. Turbopack bundles the worker and its `core/` imports into its own chunk.
2. Fallback: extend `scripts/build-worker.mts` with a second esbuild entry, `features/playground/worker/pipeline.worker.ts` → `public/workers/pipeline.worker.js`:
   - `platform: "browser"`, `format: "esm"`, the same deterministic options
   - created with `new Worker("/workers/pipeline.worker.js", { type: "module" })`
   - extend `check-build.mts` to scan the file as well
   - add it to `.gitignore` as a build artifact

- [ ] **Step 1:** Try path 1 under `npm run dev`. Open `/playground/spike` with `webapp-testing` or Playwright, and record whether the answer renders and whether any CSP violation appears in the console.
- [ ] **Step 2:** Run `npm run build && npm run start`, then repeat the check on port 3000. Run `node scripts/check-build.mts` and confirm it is green **and** that it scanned the worker chunk: name the chunk file and grep it for `@babel/parser` code.
- [ ] **Step 3:** If either step fails, implement path 2 and repeat Steps 1–2.
- [ ] **Step 4:** Write the outcome in the task report: which path shipped, the chunk name and gzip size of the worker, and the gzip size of `/playground`'s first-load JS. The worker must **not** be part of the first-load JS (principle 9's 250 KB budget excludes lazy chunks).
- [ ] **Step 5:** Delete the spike page. Keep `pipeline.worker.ts`, which Task 3 rewrites. Commit: `chore(playground): spike browser worker bundling (path N)`.

**Done when:** a worker that imports `core/` answers in both `next dev` and `next start` with zero CSP console errors, `check-build` passes with the worker scanned, and the report names the shipped path for ADR-039.

---

### Task 2: `LineIndex` and boundaries (core, pure)
**Run with:** Sonnet, medium. **Review:** Sonnet, low.

**Files:**
- Create: `core/views/lineIndex.ts`, `core/views/lineIndex.test.ts`, `core/timeline/boundaries.ts`, `core/timeline/boundaries.test.ts`
- Modify: `core/views/types.ts` (export the existing `attributions(program)` as `sourceAttributions`, unchanged)

**Interfaces — Produces:**
- `type Pane = "source" | "ast" | "bytecode" | "asm" | "binary"`.
- `type LineIndex = { readonly panes: Readonly<Record<Exclude<Pane, "source">, readonly (readonly BytecodePos[])[]>>; readonly source: readonly (readonly BytecodePos[])[] }`:
  - Each array is indexed by **0-based line** of that pane.
  - Code panes concatenate their functions' lines in view order, matching how Phase 6 renders them.
  - `source[l]` holds the positions whose attributed source offset falls on line `l` of `strippedJs`, using `lineColumn` from `core/shared/diagnostics`.
- `buildLineIndex(program: BytecodeProgram, views: { ast; bytecode; asm; binary }, strippedJs: string): LineIndex`.
- `linesForPositions(index: LineIndex, pane: Pane, positions: readonly BytecodePos[]): number[]`: sorted and unique.
- `positionsForLine(index: LineIndex, pane: Pane, line: number): readonly BytecodePos[]`: returns `[]` when out of range.
- `jobBoundaries(ticks: readonly Tick[]): number[]`: the indices `i > 0` where `phase` or `loopPhase` differs from tick `i-1`. Index 0 is always included.

- [ ] **Step 1: Failing tests**, built from a real compile of the `nexttick-vs-promise` fixture source:
  - every line of the `bytecode` pane that has positions maps back through `positionsForLine` → `linesForPositions` to a set containing that line
  - `linesForPositions(index, "source", [pos of a console.log call])` returns the 0-based line of that call in the fixture text
  - an out-of-range line returns `[]`
  - `JSON.parse(JSON.stringify(index))` deep-equals `index` (it is plain data)
  - `jobBoundaries` on `simulate(...)` ticks starts with `0`, is strictly increasing, and every listed index has a different `phase` or `loopPhase` from its predecessor
  - `jobBoundaries([])` is `[]`
- [ ] **Step 2:** `npx vitest run core/views/lineIndex core/timeline/boundaries` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun → PASS. Commit: `feat(core): plain line index and job boundaries for the client`.

**Done when:** both test files pass in the Node environment, and `npm run lint` shows that `core/` has no new imports outside `core/`.

---

### Task 3: Worker protocol, pure handler, worker entry
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create: `features/playground/worker/protocol.ts`, `features/playground/worker/handleRequest.ts`, `features/playground/worker/handleRequest.test.ts`
- Modify: `features/playground/worker/pipeline.worker.ts` (from Task 1)

**Interfaces — Produces (`protocol.ts`):**
- `PipelineRequest = z.object({ type: z.literal("run"), jobId: z.number().int().positive(), source: z.string().max(65_536), lang: z.enum(["js", "ts"]) }).strict()`.
  - The core still enforces the 10,240-byte limit, with its own diagnostic.
  - The 65,536 cap only bounds memory.
- `PipelineResponse` is a discriminated union on `type`, each member `.strict()` with `jobId`:
  - `{ type: "compiled"; jobId; diagnostics: Diagnostic[]; strippedJs: string | null; views: ClientViews | null; lineIndex: LineIndex | null; baselines: BaselineCode[] | null }`. `views`, `lineIndex` and `baselines` are null exactly when there are diagnostics.
  - `{ type: "simulated"; jobId; timeline: string /* max TIMELINE_MAX_CHARS */; boundaries: number[]; tickCount: number; exitCode: number; warnings: string[]; stop: SimulationStop | null }`.
  - `{ type: "failed"; jobId; message: string /* max 500 */ }`.
- `ClientViews = { ast: AstViewOutput; bytecode: BytecodeViewOutput; asm: AsmViewOutput; binary: BinaryViewOutput }`. Its schema checks the outer shapes and line `text`/`positions`; nested AST details can be `z.unknown()`. `TIMELINE_MAX_CHARS = 20 * 1024 * 1024`.
- `parseRequest(data: unknown): PipelineRequest | null` and `parseResponse(data: unknown): PipelineResponse | null`, both via `safeParse`.

**Interfaces — Produces (`handleRequest.ts`):**
- `handleRequest(request: PipelineRequest, post: (response: PipelineResponse) => void): void`.
  - It compiles once.
  - On diagnostics it posts `compiled` with nulls and **no** `simulated`.
  - Otherwise it posts `compiled` (it reads `views.asm`/`.binary`, builds `buildLineIndex` and the baselines), then runs `new SimulationEngine().run(program, { tiering: new TieringModel() })` and posts `simulated` with `TimelineStore.fromTicks(result.ticks).serialize()` and `jobBoundaries(result.ticks)`.
  - Any thrown error posts `failed` with `error.message` truncated to 500 characters, never the source.
- `pipeline.worker.ts`: `self.onmessage = (e) => { const r = parseRequest(e.data); if (r) handleRequest(r, (m) => self.postMessage(m)); }`.
  - An invalid request is dropped silently. The client only sends schema-built messages, so an invalid one is a bug, not an input.

- [ ] **Step 1: Failing tests** (Node environment; `post` collected into an array):
  - **Natives/test262 unreachable (D6):** `parseRequest({ type: "run", jobId: 1, source: "", lang: "js", natives: true })` and the same with `host: "test262"` return `null`. `jobId: 0`, `jobId: 1.5`, `lang: "py"` and a non-string `source` return `null`.
  - The `nexttick-vs-promise` source posts exactly `[compiled, simulated]`, in that order, with the same `jobId`. `TimelineStore.deserialize(sim.timeline).length === sim.tickCount`. Every console line of the last tick, joined, equals the fixture's recorded `stdout` from its `*.expected.json`.
  - `"Math.random()"` posts exactly one `compiled` with `E_EXCLUDED_API` and `views === null`.
  - Every response passes `parseResponse`. `parseResponse({ ...valid, extra: 1 })` and a `simulated` whose `timeline` is longer than `TIMELINE_MAX_CHARS` return `null` (**Review Focus 4**).
  - A response is structured-clone-safe: `structuredClone(response)` deep-equals it, which proves no getters or class instances remain.
  - If `SimulationEngine.run` throws (`vi.spyOn` its prototype), the handler posts `failed` and the message does not contain the source text.
- [ ] **Step 2:** `npx vitest run features/playground/worker` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun → PASS. Run `npm run build:worker` (if path 2 shipped), then `npm run lint`. Commit: `feat(playground): zod-validated pipeline worker protocol and handler`.

**Done when:** all handler tests pass, the fixture's stdout reproduces through the worker path, and a request carrying `natives` or `host` cannot be parsed.

---

### Task 4: `PipelineClient` (debounce, stale drop, supersede, crash)
**Run with:** Sonnet, high. **Review:** Sonnet, medium.

**Files:**
- Create: `features/playground/worker/PipelineClient.ts`, `features/playground/worker/PipelineClient.test.ts`, `features/playground/test/fakeWorker.ts`

**Interfaces — Consumes:** Task 3's `PipelineRequest`, `PipelineResponse` and `parseResponse`.

**Interfaces — Produces:**
- `type WorkerLike = { postMessage(m: PipelineRequest): void; terminate(): void; onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e: unknown) => void) | null; onmessageerror: ((e: unknown) => void) | null }`.
- `type PipelineEvent = { kind: "started"; jobId: number } | { kind: "response"; response: PipelineResponse } | { kind: "failed"; jobId: number; message: string }`.
- `createPipelineClient(deps: { createWorker: () => WorkerLike; onEvent: (e: PipelineEvent) => void; setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (h: unknown) => void; debounceMs?: number /* 400 */ }): { request(source: string, lang: Language): void; flush(): void; dispose(): void }`.
  - `request` (re)starts the debounce timer, and `flush` dispatches the pending request now.
  - Dispatch increments `jobId` from 1, emits `started`, and posts.
  - If a job is in flight (a `compiled` without its `simulated`, or nothing yet), it first calls `terminate()` and creates a new worker (D3).
  - A response is emitted only if `parseResponse` accepts it **and** `response.jobId === latestJobId`. Anything else is dropped.
  - `onerror`, `onmessageerror` and an unparsable message emit `failed` for the latest job, then drop the worker, so the next dispatch creates a fresh one.
  - `dispose` clears the timer and terminates the worker.
- `fakeWorker.ts`: `createFakeWorker(): { factory: () => WorkerLike; instances: FakeWorker[] }`. A `FakeWorker` records `posted`, has a `terminated` flag, and exposes `emit(data)`, `crash()` and `respondWith(handleRequest)`, which runs Task 3's real handler asynchronously.

- [ ] **Step 1: Failing tests** (fake timers via injected `setTimer`):
  - **Debounce:** three `request` calls within 400 ms post exactly one message with the last source, and 399 ms after the last call nothing is posted yet.
  - **Stale drop (done-when):** dispatch job 1, then job 2. A `simulated` with `jobId: 1` emitted on **either** worker instance is never forwarded to `onEvent`, while job 2's is.
  - **Supersede (Review Focus 1):** dispatching job 2 while job 1 has no `simulated` yet marks instance 0 `terminated` and posts job 2 to instance 1. A dispatch after job 1 finished reuses the same instance.
  - **Crash (Review Focus 4):** `crash()` emits `failed` for the latest job, and the next `request` + `flush` creates a new instance. An unparsable `{ type: "simulated", jobId: 1 }` emits `failed`, not `response`.
  - `dispose()` terminates the instance, and a pending debounce never fires afterwards.
- [ ] **Step 2:** `npx vitest run features/playground/worker/PipelineClient` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun → PASS. Commit: `feat(playground): pipeline client with debounce, stale-job drop and worker restart`.

**Done when:** the stale-drop and supersede tests pass. This is done-when item 3.

---

### Task 5: Store and timeline holder
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create: `features/playground/store/playgroundStore.ts`, `features/playground/store/timelineHolder.ts`, `features/playground/store/playgroundStore.test.ts`, `features/playground/test/fixtureTimeline.ts`
- Modify: `package.json` (add `use-sync-external-store` as a direct dependency, pinned to the installed version)

**Interfaces — Consumes:** Task 4's `PipelineEvent` and Task 2's `LineIndex`.

**Interfaces — Produces:**
- `type PipelineStatus = "idle" | "compiling" | "simulating" | "ready" | "refused" | "failed"`.
- `type PlaygroundState`:
  - `editor: { source: string; lang: Language; diagnostics: readonly Diagnostic[] }`
  - `compile: { jobId: number; status: PipelineStatus; message: string | null; strippedJs: string | null; views: ClientViews | null; lineIndex: LineIndex | null; baselines: readonly BaselineCode[] | null; boundaries: readonly number[]; timelineVersion: number; exitCode: number | null; warnings: readonly string[]; stop: SimulationStop | null }`
  - `playback: { index: number; isPlaying: boolean; speed: PlaybackSpeed; length: number }`
  - `hover: { pane: Pane | null; line: number | null }`
  - the actions below
- `type PlaybackSpeed = 0.25 | 0.5 | 1 | 2 | 4 | 8`, and `PLAYBACK_SPEEDS` as a readonly tuple.
- Actions:
  - `setSource(source)`, `setLang(lang)`
  - `applyPipelineEvent(e: PipelineEvent)`
  - `play()`, `pause()`, `togglePlay()`
  - `seek(index)`: clamps to `[0, length-1]` and is a no-op at length 0
  - `step(delta: number)`
  - `jumpBoundary(direction: -1 | 1)`: the nearest boundary strictly before or after `index`, else the timeline's start or end
  - `setSpeed(s)`
  - `setHover(pane, line)`, `clearHover()`
- `createPlaygroundStore(initial?: { source?: string; lang?: Language }): PlaygroundStore`, using `createStore(subscribeWithSelector(...))`.
- `timelineHolder.ts`: `getTimeline(store): TimelineStore | null` and `setTimeline(store, t: TimelineStore | null): void`, backed by a module `WeakMap` (D7).
- `applyPipelineEvent` rules:
  - `started` → `status: "compiling"`.
  - `compiled` → set the editor diagnostics and the compile DTOs, `status` becomes `"simulating"` or `"refused"`, **and in the same `setState`** `setTimeline(store, null)`, `timelineVersion+1` and `playback = { index: 0, isPlaying: false, length: 0 }` (D2).
  - `simulated` → `setTimeline(TimelineStore.deserialize(...))` (a throw becomes `status: "failed"`), set the summary and boundaries, `length = tickCount`, `index: 0`, `timelineVersion+1`, `status: "ready"`.
  - `failed` → `status: "failed"`, `message`, `isPlaying: false`.
  - An event whose `jobId` is lower than `compile.jobId` is ignored (a second guard behind Task 4).
- `fixtureTimeline.ts` (test helper): `fixtureRun(name: string): { source; compiled: PipelineResponse & { type: "compiled" }; simulated: PipelineResponse & { type: "simulated" } }`. It reads the fixture source from `tests/conformance/fixtures/` and runs Task 3's `handleRequest` in-process.

- [ ] **Step 1: Failing tests** (Node environment; the store is vanilla):
  - after `compiled` then `simulated` for `nexttick-vs-promise`: `getTimeline(store)?.length === playback.length === simulated.tickCount`, and `status === "ready"`
  - **D2 swap:** with a ready timeline at `index: 7`, applying job 2's `compiled` yields `getTimeline(store) === null`, `length 0`, `index 0` and a bumped `timelineVersion`, and a subscriber sees **one** notification for that change
  - **Review Focus 5:**
    - `seek(10_000)` clamps to `length-1`
    - at length 0, `seek`, `step`, `play` and `jumpBoundary` leave `playback` unchanged and `isPlaying` false
    - a refused program ends with `status: "refused"`, its diagnostics in `editor.diagnostics`, and no timeline
  - `jumpBoundary(1)` from 0 lands on `boundaries[1]`, and `jumpBoundary(-1)` from there returns to 0
  - a `failed` event stops playback
  - a `simulated` whose timeline string is corrupt → `status: "failed"`, and the previous holder value stays `null`
  - a `started` for job 1 after job 2 is ignored
- [ ] **Step 2:** `npx vitest run features/playground/store` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun → PASS. Commit: `feat(playground): zustand store with timeline held outside state`.

**Done when:** all store tests pass, and the timeline object is provably absent from `store.getState()` (a test asserts that no value reachable from the state is `instanceof TimelineStore`).

---

### Task 6: Selector hooks and render-count tests
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create: `features/playground/store/PlaygroundContext.tsx` (`PlaygroundStoreContext`, `usePlaygroundStore()`, which throws outside the provider; this is a programmer error), `features/playground/hooks/useTickSelectors.ts`, `features/playground/hooks/useHighlightedLines.ts`, `features/playground/hooks/hooks.test.tsx`

**Interfaces — Consumes:** Task 5's store, `getTimeline` and `fixtureRun`.

**Interfaces — Produces:**
- An internal `useTick<T>(select: (tick: Tick) => T, empty: T): T`.
  - It is `useStore(store, useShallow((s) => { void s.compile.timelineVersion; const t = getTimeline(store); return t && s.playback.length > 0 ? select(t.at(s.playback.index)) : empty; }))`.
  - `empty` is a module-level constant per hook, so empty results are reference-stable.
- Exports:
  - `useCallStack(): Tick["callStack"]`
  - `useQueues(): { nextTick; microtask; timers; immediates; hostApis }`: the five tick arrays, by reference
  - `useLoopPhase(): { phase: TickPhase | null; loopPhase: LoopPhase | null }`
  - `useConsole(): Tick["console"]`
  - `useV8State(): Tick["v8"] | null`
  - `useNarration(): string`
  - `useFidelityWarnings(): Tick["warnings"]`
- `useHighlightedLines(pane: Pane): { current: readonly number[]; hovered: readonly number[] }`:
  - `current` = `linesForPositions(lineIndex, pane, [tick.pos])` when `pos` exists.
  - `hovered` = the lines of `pane` for `positionsForLine(lineIndex, hover.pane, hover.line)` when hovering. Hovering a line of the same pane includes that line.
  - It uses `useStoreWithEqualityFn` from `zustand/traditional` with an element-wise equality on both arrays.

- [ ] **Step 1: Failing tests** (`// @vitest-environment jsdom`; `@testing-library/react`; a test `Provider` around a store loaded with `fixtureRun("nexttick-vs-promise")`). One probe component per hook increments its own counter on render. All index changes go through `act(() => store.getState().seek(i))`.
  - **Done-when 1:** pick indices `a`, `b` where `at(a).console === at(b).console` by reference but `callStack` differs (find them by scanning the timeline in the test). `seek(b)` from `a` re-renders the `useCallStack` probe exactly once and the `useConsole` probe **zero** times.
  - A probe that subscribes to no tick hook, but sits inside the provider, renders **zero** times across 50 `seek` calls.
  - `useNarration` re-renders only when `narration` changes. Count the changes between consecutive ticks over the whole timeline, and assert the render count equals that number.
  - `useHighlightedLines("bytecode")`: `current` contains the line that `linesForPositions` gives for the tick's `pos`. `setHover("source", l)` fills `hovered` with the bytecode lines of source line `l`. A `seek` that keeps the same `pos` does not re-render.
  - **Review Focus 5:** with a refused program, every hook returns its empty constant, and `TimelineStore.prototype.at` (spied) is never called.
  - **D2 in the UI:** the timeline swap from Task 5 re-renders `useCallStack` once, to the empty value.
- [ ] **Step 2:** `npx vitest run features/playground/hooks/hooks.test.tsx` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun → PASS. Commit: `feat(playground): selector hooks with shallow equality and render-count proofs`.

**Done when:** the render-count tests pass. This is done-when item 1.

---

### Task 7: `useHardwareFrame` with zero renders
**Run with:** Sonnet, medium. **Review:** Sonnet, low.

**Files:**
- Create: `features/playground/hooks/useHardwareFrame.ts`, `features/playground/hooks/useHardwareFrame.test.tsx`

**Interfaces — Produces:**
- `type HardwareFrame = { tick: Tick; machine: MachineState | null }`.
- `useHardwareFrame(onFrame?: (frame: HardwareFrame | null) => void): { readonly current: HardwareFrame | null }`.
  - The hook returns a stable ref object.
  - In `useEffect` it reads `store.getState()` once, then subscribes with `store.subscribe((s) => [s.playback.index, s.compile.timelineVersion] as const, update, { equalityFn: shallow })`.
  - `update` sets `ref.current` from `getTimeline` + `machineStateAt(tick, baselines[tick.pos.functionId])` (`null` when there is no `pos` or no baseline) and calls `onFrame` (Phase 7 passes R3F's `invalidate`).
  - It unsubscribes on unmount. It never calls `useState` or `useStore` with a selector.

- [ ] **Step 1: Failing test (done-when 2):** a probe using `useHardwareFrame(spy)` inside the fixture provider.
  - 100 `seek` calls → the probe's render count stays **1** (the mount)
  - `spy` is called 100 times
  - `ref.current.tick.index` equals the final index
  - `ref.current.machine` is non-null on a tick whose `pos` points into a function with a baseline
  - after unmount, a `seek` calls `spy` no more
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. Commit: `feat(playground): transient hardware-frame hook with zero renders`.

**Done when:** the zero-render test passes. This is done-when item 2.

---

### Task 8: `PlaybackClock` (rAF)
**Run with:** Sonnet, medium. **Review:** Sonnet, low.

**Files:**
- Create: `features/playground/playback/PlaybackClock.ts`, `features/playground/playback/PlaybackClock.test.ts`

**Interfaces — Produces:**
- `BASE_TICKS_PER_SECOND = 4` and `MAX_FRAME_DELTA_MS = 250` (D5).
- `createPlaybackClock(deps: { store: PlaygroundStore; requestFrame: (cb: (nowMs: number) => void) => number; cancelFrame: (h: number) => void }): { dispose(): void }`.
  - It subscribes to `playback.isPlaying`. While playing, every frame adds `min(delta, 250) * BASE_TICKS_PER_SECOND * speed / 1000` to a fractional accumulator, and calls `seek` only when the whole part advances.
  - At `length-1` it calls `pause()`.
  - On pause it cancels the pending frame and resets the accumulator, and the first frame after `play` only records the timestamp.

- [ ] **Step 1: Failing tests** (a fake frame queue driven by the test):
  - at speed 1, 1,000 ms of 16 ms frames advances `index` by exactly 4
  - at speed 8, by 32
  - at 0.25, 250 ms gives no advance and 1,000 ms gives 1
  - **Review Focus 2:** a single 30,000 ms frame gap advances by at most `ceil(250 * 4 * speed / 1000)`
  - reaching the end sets `isPlaying` false and requests no more frames
  - during a 1 s run at speed 1, `seek` is called no more than 4 times (no `setState` without an index change)
  - `dispose` cancels the pending frame
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. Commit: `feat(playground): rAF playback clock with clamped frame delta`.

**Done when:** the clock tests pass.

---

### Task 9: Keyboard shortcuts
**Run with:** Sonnet, medium. **Review:** Haiku, low.

**Files:**
- Create: `features/playground/keyboard/shortcuts.ts`, `features/playground/keyboard/useShortcuts.ts`, `features/playground/keyboard/shortcuts.test.ts`

**Interfaces — Produces:**
- `type ShortcutAction = "toggle-play" | "step-back" | "step-forward" | "boundary-back" | "boundary-forward" | "first" | "last"`.
- `shortcutFor(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; editable: boolean }): ShortcutAction | null`.
  - It returns `null` when `editable`, or when any of Ctrl, Meta or Alt is held.
  - Keys: `" "` → toggle-play; `ArrowLeft`/`ArrowRight` → step, or boundary with Shift; `Home` → first; `End` → last.
- `isEditableTarget(t: EventTarget | null): boolean`: true for `input`, `textarea`, `select` and any element inside `[contenteditable]`, which includes CodeMirror's `.cm-content`.
- `useShortcuts(store)`: a `keydown` listener on `window` that maps the event through `shortcutFor`, then `preventDefault()` and dispatches to the store actions (`step(∓1)`, `jumpBoundary(∓1)`, `seek(0)`, `seek(length-1)`, `togglePlay()`).

- [ ] **Step 1: Failing tests:**
  - the full key table
  - **Review Focus 3:** `editable: true` returns `null` for every key; `ctrlKey` + `ArrowLeft` and `metaKey` + `" "` return `null`
  - jsdom: `isEditableTarget` is true for a `textarea` and for a `span` inside a `div[contenteditable="true"]`
  - with `useShortcuts` mounted, a `keydown` `" "` dispatched on a `textarea` leaves `isPlaying` unchanged, and the same key dispatched on `document.body` toggles it
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. Commit: `feat(playground): playback keyboard shortcuts that ignore editable targets`.

**Done when:** the shortcut tests pass.

---

### Task 10: Provider, page wiring and the worker e2e smoke
**Run with:** Sonnet, medium. **Review:** Sonnet, medium.

**Files:**
- Create: `features/playground/store/PlaygroundProvider.tsx` (`"use client"`), `features/playground/components/PipelineSmoke.tsx` (`"use client"`; a minimal, token-styled, unstyled-layout shell that Phase 6 replaces: a `<textarea aria-label="Source">`, a status line, and a `<pre data-testid="console">` from `useConsole()` at the last tick after `seek(length-1)`), `e2e/playground-worker.spec.ts`
- Modify: `app/playground/page.tsx` (keep it a Server Component; render the provider with the shell)

**Interfaces — Produces:**
- `PlaygroundProvider({ initialSource?, initialLang?, children })`.
  - It creates the store once (`useState(() => createPlaygroundStore(...))`).
  - In `useEffect` it creates the `PipelineClient` with Task 1's worker factory and `window.setTimeout`/`clearTimeout`, the `PlaybackClock` with `requestAnimationFrame`, and `useShortcuts`.
  - It subscribes to `editor.source`/`lang` → `client.request`, and calls `flush()` once on mount.
  - It disposes all three on unmount, which covers React StrictMode's double effect.

- [ ] **Step 1: Failing e2e** (`e2e/playground-worker.spec.ts`, against the production server that `npm run e2e` starts):
  - load `/playground`
  - fill the textarea with the `nexttick-vs-promise` fixture source
  - wait for the status to show `ready`
  - `[data-testid=console]` text equals the fixture's recorded stdout (read from its `*.expected.json`)
  - **no** console message matches `Content Security Policy` and no `pageerror` fires
  - typing a second program right away ends `ready` with the **second** program's output (stale drop, end to end)
- [ ] **Step 2:** `npm run e2e -- playground-worker` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun → PASS. Commit: `feat(playground): mount the pipeline worker behind a provider`.

**Done when:** the e2e passes under `next start`, the existing `e2e/security.spec.ts` still passes, and the report gives the measured gzip first-load JS for `/playground` and shows that the worker is a separate chunk or file.

---

### Task 11: Docs
**Run with:** Sonnet, low. **Review:** Haiku, low.

- [ ] ADR-039 to ADR-045 for D1–D7. ADR-039 also records Task 1's shipped bundling path, with chunk names and sizes.
- [ ] `docs/ARCHITECTURE.md`: replace the "Browser" bullet with a "Phase 5: client worker and store" section. Include the diagram `editor → PipelineClient (400 ms, jobId) → pipeline.worker (compile → run) → compiled/simulated → store (+ timeline holder) → hooks → components`.
- [ ] `docs/FIDELITY.md`: one row saying the client changes nothing in the Exact layer, because the worker runs the same `simulate` pipeline (proven by Task 3's stdout test). Note that playback speed is presentation only.
- [ ] `PROMPT.md`: update the status line (Phase 5 implemented, its plan, ADR-039 to ADR-045). In `CLAUDE.md`, change the command table only if Task 1 added a script.
- [ ] Commit: `docs: phase 5 decisions and architecture`.

**Done when:** every decision D1–D7 has an ADR, and `npm run lint` passes (it covers docs only through `docs:subset`, which is unchanged).

---

### Task 12: Full verification
**Run with:** Haiku, low. **Review:** none.

- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run conformance`, `npm run build` (which includes `check-build`) and `npm run e2e`, and report the output verbatim. `asm.test.ts` must pass against Phase 4's recorded goldens. `git status` must show zero `*.expected.json` diffs.
- [ ] Any failure goes back to the orchestrator, which dispatches the fix with the failing task's model.

**Done when:** all six commands pass, with their output shown.

---

### Task 13: Final review
**Run with:** Opus, medium. **Review:** none.

- [ ] Run a bug and security review of `git diff main...phase-5`, focused on:
  - the worker as a trust boundary (schema strictness, natives/test262 reachability, nothing evaluates source, no blob worker)
  - race conditions in `PipelineClient` and in the D2 swap
  - render isolation (any hook that returns a fresh object per tick)
  - leaks: workers, rAF handles or listeners left after unmount
  - the CSP

**Done when:** a findings list exists, ranked by severity, with a verdict for each.

---

### Task 14: Fix agreed findings, re-verify, report
**Run with:** Sonnet, medium. **Review:** Haiku, low.

- [ ] Fix the findings the orchestrator accepted, list the rejected ones with reasons, and re-run Task 12.
- [ ] Report per PROMPT §4 step 6: what was built, the verification output, the ADRs, the fidelity gaps (none expected) and the open risks below. Then **stop for review**.

**Done when:** Task 12 passes again after the fixes, and the report is delivered.

---

## Done-when → test map

| PROMPT Phase 5 criterion | Test |
|---|---|
| Changing `index` re-renders only subscribed components | `features/playground/hooks/hooks.test.tsx` (Task 6) |
| The 3D hook causes zero renders during playback | `features/playground/hooks/useHardwareFrame.test.tsx` (Task 7) |
| Stale jobs are dropped | `PipelineClient.test.ts` (Task 4), `playgroundStore.test.ts` (Task 5), `e2e/playground-worker.spec.ts` (Task 10) |
| Worker messages are Zod-validated; natives/test262 unreachable (ADR-031) | `handleRequest.test.ts` (Task 3) |

## Open risks

- **Main-thread deserialize cost.** A 20 MB timeline parsed with `JSON.parse` on the main thread can take around 100 ms or more. Measure it on the worst-case `TimelineStore.test.ts` run during Task 5. If it exceeds one frame budget noticeably, a follow-up can move `at()` behind the worker. That makes reads async, so it is out of scope here.
- **Worker bundling** depends on Task 1. If path 2 ships, the browser worker is a build artifact like the compile worker (ADR-032), so a `core/` change reaches the browser only through `build:worker`.
- **`/playground` bundle budget (250 KB gzip).** `TimelineStore`, `lineIndex` and `machineStateAt` load on the main thread. Task 10 measures the budget, and Phase 9 enforces it.
- **Deep links (`?t=42`)** are Phase 8. `seek` already clamps, so they will plug in directly.
- **The base playback rate** (4 ticks/s at 1×) is a guess for the owner to tune in Phase 6.
