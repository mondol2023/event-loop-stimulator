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

`core/compile/CompilationManager` runs the front half in one place: strip a leading BOM, check the size limits, strip types (TypeScript), parse, analyze scopes, validate the subset, generate bytecode, and emit the views. The first stage that reports a diagnostic stops the pipeline and no `program` is returned; `compile` never throws. `core/views` holds the AST and Bytecode views as pure emitters (`CodeViewStrategy`), and `positionsForSourceRange` / `sourceRangeForPos` map between source ranges and `(functionId, bytecodeOffset)` through the `SourcePositionTable` ([ADR-024](DECISIONS.md)).

Bytecode fidelity is held by a ratchet against real `--print-bytecode` output ([ADR-022](DECISIONS.md), [ADR-023](DECISIONS.md)).

The bytecode is the single source of truth, as it is in V8:

- The interpreter executes the same `BytecodeArray`s that the panes display.
- The baseline compiler is a per-bytecode template translation, as Sparkplug is, so the asm pane can't drift from the bytecode.
- Every mapping in the app (AST node, asm span, byte span, tick) goes through `(functionId, bytecodeOffset)`.

## Phase 3: V8's side, Node's side, and the timeline

The simulator mirrors who owns what in real Node. V8 owns values, objects, Maps, inline caches, the heap, the spec operations, the builtins, promises and the microtask queue, and the Ignition interpreter. Node owns the event loop, `process.nextTick`, timers, immediates, unhandled-rejection processing, the console streams and the fatal-exception printer. The two meet in a narrow `HostHooks` interface (write to a stream, name the entry point, track a rejection, observe a microtask enqueue), the way an embedder plugs into V8.

```
        ┌───────────────────────────── core/host  (Node) ─────────────────────────────┐
        │  NodeEventLoop · VirtualClock · nextTick · timers · rejections · errorPrinter │
        │  nodeGlobals · nodeFrames (pinned internal frames) · nondeterminism · warnings│
        └───────▲──────────────── HostHooks ───────────────────────┬───────────────────┘
                │ write · entryPoint · promiseRejectionTracker     │ runs jobs, calls callbacks
        ┌───────┴──────────────── core/runtime  (V8) ──────────────▼───────────────────┐
        │  Realm · values/objects · V8Map + TransitionTree · FeedbackVector (ICs)       │
        │  spec ops · builtins (Object, Array, Math, Error, Promise, console, inspect)  │
        │  MicrotaskQueue · heap (Illustrative)                                         │
        └───────▲──────────────────────────────────────────────────────────────────────┘
                │ Completion values (a JS throw is a value, never a TS throw)
        ┌───────┴──────────── core/interpreter ─────────────┐
        │  IgnitionInterpreter · Frame · dispatch/*          │  executes the BytecodeArrays of Phase 2
        └────────────────────────────────────────────────────┘
```

`core/runtime` and `core/interpreter` know nothing of Node; `core/host` is the only layer that knows the loop. The only TypeScript `throw` that crosses a layer is `SimulationHalt` (a limit or an unsupported behavior, [ADR-027](DECISIONS.md)); its definitions live in `core/shared`, which is why the layers below `core/timeline` can use them.

### Command → Tick → TimelineStore

```
IgnitionInterpreter ─┐  Command: dispatch · job-start · job-end · loop-phase · gc · exit
NodeEventLoop       ─┼──────────────▶ StepObserver ──▶ GcObserver (adds modeled gc commands)
MicrotaskQueue      ─┘                                        │
                                                              ▼
                              TickRecorder (records)  or  TickLimiter (counts only)
                                 │  TickBoundary decides which commands make a Tick
                                 │  (statement-level, ADR-028); the same rule for both
                                 ▼
                       Tick (read-only snapshot + narration) ──▶ SimulationResult.ticks
                                                                      │
                                                                      ▼
                              TimelineStore.fromTicks: keyframe every 64 ticks + patches,
                              LRU of 256 materialized ticks, ≤ 20 MB serialized (ADR-030)
```

- **`SimulationEngine`** builds a fresh `Realm`, interpreter and loop for each run, wires the observer chain, and is the only code that catches `SimulationHalt`. `simulate(source, lang, options)` compiles with `CompilationManager` and then runs it; the same input gives the same result.
- **The recorder only reads.** It never allocates on the heap, calls a function, reads an `Error.stack` or changes a queue, so a recorded run prints exactly what an unrecorded run prints. `record: false` swaps it for the `TickLimiter`, which counts the same ticks, so a run stops at the same place either way.
- **`/api/compile`** runs `simulate` with `record: false` and answers a summary ([ADR-032](DECISIONS.md)); the timeline is built by the client's own Web Worker (Phase 5).
- **Test-only modes.** `natives` (compile) and `host: "test262"` (simulate) are options of the functions, in no schema and no UI path ([ADR-026](DECISIONS.md), [ADR-031](DECISIONS.md)).

## Phase 4: baseline machine code and the tiering model

Machine code is **Illustrative** and tiering is **Modeled**; neither may influence the Exact layer.

```
BytecodeProgram ──▶ BaselineCompiler ──▶ BaselineCode (asm lines + bytes, each mapped to a bytecode offset)
                      │ TEMPLATES (one per opcode, exhaustive by type, ADR-035)
                      ▼
                    x64/ (table-driven Encoder, register roles of register-x64.h)

IgnitionInterpreter ──hooks──▶ TieringModel ──readout──▶ TickRecorder: v8.tiers, v8.tierEvents
tick + BaselineCode ──▶ machineStateAt (pure, derived, ADR-033) ──▶ asm line, rax/rsi/rbp/rsp, flags
```

- **`core/baseline`** compiles each bytecode through a pure template, so the asm and byte views map to `(functionId, bytecodeOffset)` like every other view. The encoder is checked against a real LLVM assembler (`llvm-mc`, or `clang` as a fallback) by `npm run asm:record` and `tests/conformance/asm.test.ts` ([ADR-036](DECISIONS.md)).
- **`core/interpreter/tiering`** is an observer. The interpreter only calls write-only hooks; the timeline only reads `tiers()` and drains events, so nothing flows back into a run ([ADR-037](DECISIONS.md)). Tier changes are not ticks ([ADR-034](DECISIONS.md)).
- **Layout.** `core/baseline/` holds `BaselineCompiler.ts`, `Template.ts`, `templates/` (one file per opcode family, `index.ts` the exhaustive `TEMPLATES`), `x64/` (`Encoder.ts`, `encodings.ts`, `registers.ts`, `syntax.ts`), `frame.ts`, `isolateData.ts`, `illustrativePointers.ts` and `machineState.ts`. The register, Smi and pointer scheme is Illustrative and not Node's layout ([ADR-039](DECISIONS.md)).
- **Compile views.** `views.asm` and `views.binary` of a compiled program are lazy memoised getters; a failing emit is an `unavailable` view (`E_TEMPLATE` or `E_INTERNAL`), never a throw ([ADR-038](DECISIONS.md)).
- **Timeline.** A Tick gains `v8.tiers` and `v8.tierEvents` only when a `TieringModel` is attached, and `TickRecorder.finish()` attaches events pending after the last tick to it ([ADR-034](DECISIONS.md)). `machineStateAt` computes the machine state on demand, so no `machine` is stored ([ADR-033](DECISIONS.md)).
- **Asm recorder.** `scripts/conformance/asm-record.mts` (with `asm-forms.mts` and `asm-assembler.mts`) is the only new `child_process` user. It runs a local assembler (`llvm-mc`, or `clang` as a fallback) on asm text the repo generated, never user source, and writes `tests/conformance/asm/encodings.expected.json`, which `asm.test.ts` checks offline ([ADR-036](DECISIONS.md)).
- **`/api/compile`** is unchanged ([ADR-038](DECISIONS.md)).

## Directory layout

```
app/                 routing only: thin pages that compose features (+ api/ route handlers)
proxy.ts             optimistic session redirect, security headers, request id
instrumentation.ts   validates the environment on server boot
core/                PURE TS, runs in browser, worker and server:
                     frontend/ bytecode/ views/ compile/ shared/   (Phase 2)
                     runtime/ interpreter/ host/ timeline/         (Phase 3)
                     baseline/ interpreter/tiering/                (Phase 4)
features/            React feature modules (components/, hooks/, store/), incl. the pipeline worker
server/              `import "server-only"`: env, db, repositories, auth, security, audit, actions
components/ui/       shadcn output
lib/                 small shared UI helpers (cn)
tests/conformance/   fixtures + *.expected.json recorded on real Node, bytecode-status.json (ratchet), generator, runner, test262 runner
tests/tooling/       proofs for the lint rules, design tokens and build check
scripts/conformance/ the ONLY code that spawns real node (pinned, sandboxed) or llvm-mc/clang (repo-generated asm)
scripts/             build checks
vendor/test262/      in-subset tests only, plus exclusions.json with a reason for every test left out
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

- **Browser.** The UI renders; compile and simulate run in a Web Worker (see Phase 5 below).

- **Server.** Requests pass four layers, each of which can only reject:
  1. `proxy.ts`: mints the CSP nonce and `x-request-id`, sets the security headers, and redirects `/dashboard` and `/admin` visitors who have no session cookie. This is optimistic (no database, no unsealing) and is never the security boundary.
  2. DAL (`server/auth/dal.ts`): the real authorization point. `getCurrentUser()` re-reads the user on every request and returns null unless the account is active and the cookie's `sessionVersion` matches. `authorize(permission)` yields 401/403 and audits `rbac.denied`.
  3. Services (`authService`, `userAdmin`): the rules, rate limits and audit rows.
  4. Repositories: the only importers of Mongoose models. They return plain domain types and validate every id before a query.

  Server Actions and Route Handlers stay thin: Zod, authorize, rate limit, service, audit.
  - `POST /api/compile` runs, in order: origin + signed CSRF -> caller -> rate limit -> bounded body read -> Zod -> `worker_threads` pool (64 MB, 2 s) running the real `simulate` from a prebuilt bundle (`scripts/build-worker.mts`, [ADR-032](DECISIONS.md)) -> a `.strict()` `CompileSummary`. The pool guards resources and is not a sandbox: user code is never executed by anything.
  - Auth uses iron-session and argon2id; a password change, ban or role change bumps `sessionVersion`, which revokes every older session.
  - Data lives in MongoDB, as a replica set so transactions work; the connection opens on first use.
  - Rate limits use Redis, or memory in dev. Settings come from a Mongo `Setting` doc (30 s cache, defaults on failure).
  - Audit is fire-and-forget through a bounded queue; rows hold `codeHash`, never code, and expire after 90 days.
- **Boot.** `instrumentation.ts` validates the environment (`server/env.ts`) before the server takes requests.
- **Conformance.** Expectations come only from real Node on the pinned target, via `npm run conformance:record`. `npm test` compares against the recorded files, so CI doesn't need the pinned Node.

## Phase 5: client worker and store

```
editor → PipelineClient (400 ms, jobId) → pipeline.worker (compile → run)
       → compiled / simulated → store (+ timeline holder) → hooks → components
```

- `PipelineClient` debounces edits by 400 ms, tags each job with a `jobId` and terminates the worker when a newer job supersedes one in flight (ADR-042).
- The worker validates requests with a `.strict()` schema, runs the same `compile` and `simulate` as the tests, and posts `compiled` then `simulated` (ADR-041, ADR-045). The timeline crosses as a serialized string (ADR-040). Since Phase 7 the `simulated` response also carries `tierTracks` (from `tierTimeline`) and `hardware` (from `traceHardware`), computed once in the worker so the main thread does not rebuild them (ADR-063).
- One Zustand store per `PlaygroundProvider`. The `TimelineStore` sits in a per-store `WeakMap` holder and the state carries only `timelineVersion` (ADR-046). Hooks select DTOs (ADR-043) and read ticks from the holder. The playback clock is presentation only (ADR-044).

## Phase 6: the IDE

```
read:   store -> Phase 5 hooks (useTickSelectors, ...) -> components
write:  components -> store actions (seek, play, setMode, ...) -> store
        components -> server only via server/actions/* (none used by the playground)
```

- **Read path.** Components read through the Phase 5 hooks or `useStore(store, selector)` with a primitive or shallow selector. No component holds a `TimelineStore`; per-frame work re-renders only subscribers of the changed slice.
- **Write path.** Components write only through store actions. The command palette, keyboard shortcuts and buttons all call the same actions (ADR-047 sets the key ownership rules).
- **CSP rule (D1, ADR-048).** No SSR `style=` and a nonce for every injected `<style>`. `app/playground/page.tsx` reads `x-nonce` and provides it through `NonceProvider`; CodeMirror takes it via `EditorView.cspNonce`; inline-styled components mount on the client or set styles through refs. `tests/tooling/no-ssr-style.test.tsx` guards it.
- **Lazy code.** CodeMirror panes, Motion and the replace-example dialog load on demand (ADR-053); `PipelineClient` is imported after hydration.
- **Region map.**

  | Region | Where | Code |
  |---|---|---|
  | Top bar (status, mode, theme, palette) | top | `features/playground/components/shell/`, `palette/` |
  | Editor, examples, problems | left | `components/editor/`, `components/examples/` |
  | AST, Bytecode, Machine Code | right | `components/panes/` |
  | Event Loop (2D), Console, V8 Internals and Hardware placeholders | bottom | `components/bottom/`, `features/event-loop-2d/` |
  | Playback bar, scrubber, narration | spine, pinned at narrow widths | `components/playback/` |

  Breakpoint layouts are in `DESIGN.md`. Preferences (`sl_mode`, `sl_theme`) live in `features/preferences/` and are read by `app/layout.tsx`.
- **Core additions.** `timelineMarkers` (ADR-051), `AsmLine.intel` (ADR-052) and `Tick.narrationWithheld` (ADR-061) are pure and tested in the Node environment.
