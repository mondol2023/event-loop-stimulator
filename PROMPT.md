# Build Prompt — "Silicon Loop": a V8 Engine & Event Loop Visualizer

<how_to_use_this_prompt>
This prompt is written for **Claude Code** working inside this repository. You can give it to Claude with:
`Read PROMPT.md and execute Phase 0. Follow the workflow section exactly.`
Then run one phase per session. Each phase ends with a report and a stop for human review.
</how_to_use_this_prompt>

---

## 1. Role & Mission

<role>
You are acting as a principal software architect and senior full-stack engineer. You have working depth in:
- **V8 internals:**
  - the scanner and parser
  - Ignition bytecode, the accumulator machine
  - the Sparkplug, Maglev and TurboFan tiers
  - hidden classes (Maps), inline caches and feedback vectors
  - elements kinds, pointer tagging, and the generational heap with Orinoco GC
- **ECMAScript semantics:** the spec's abstract operations, promise jobs, async functions.
- **Node.js as an embedder:** libuv loop phases, `process.nextTick`, timers, `setImmediate`.
- **x86-64:** instruction encoding, and V8's x64 register conventions.
- **Other areas:**
  - differential and conformance testing
  - WebGL through React Three Fiber
  - web application security (OWASP ASVS level 2)
  - instructional design for developer education
</role>

<mission>
Build an educational platform that shows **how V8 really runs JavaScript**. A learner writes a small JS/TS program and then:
1. **Sees V8's pipeline.** Four synchronized panes show Source → AST & scopes → **Ignition bytecode** → **machine code** (baseline x86-64 assembly plus hex/binary). Hovering or stepping a line in any pane highlights the related lines in all the others, via V8's own concept of a source position table.
2. **Watches it run** tick by tick:
   - **Event Loop (2D):** call stack, nextTick queue, microtask queue, timers, the immediate (check) queue, libuv loop phases, console.
   - **V8 Internals:** accumulator and bytecode registers, hidden classes and their transitions, inline-cache states, elements kinds, tagged Smis versus heap pointers, young and old generation, GC events, tier-ups and deopts.
   - **Hardware (3D):** CPU registers, ALU, caches, RAM and buses executing the machine code.
3. **Gets exactly the result real V8 gives.** Console output, callback order, values, error messages and exit behavior are **identical to running the program on the pinned Node/V8 version**. Yet the user's code is **never executed by any real engine, anywhere**. See §3.
4. **Time-travels** with play, pause, step back/forward, scrub and speed controls, without re-running anything.
5. **Reads a plain-English narration** of every tick that explains *why* something happened, naming the spec operation or V8 mechanism responsible.
6. **Saves and shares** snippets via permalinks. Admins monitor the platform, users, abuse and rate limits.

The bar to clear is existing tools such as Loupe and JS Visualizer 9000. They show the queues, but they are often wrong on subtle orderings and say nothing about the engine. This platform must be **correct to the byte** on observable results, and honest about which internals are exact, which are verified models, and which are illustrations.
</mission>

---

## 2. Principles

These principles decide every trade-off this document doesn't cover. When two of them conflict, the one listed first wins. Each comes with its reason, so you can apply it with judgement rather than mechanically.

<principles>
1. **Never execute user code. Not anywhere, not ever.**
   - Not on the server, not in the browser, not in a worker, not in CI.
   - No `eval`, `new Function`, `node:vm`, `ShadowRealm`, `child_process`, iframes or `srcdoc`, blob or data-URL scripts, dynamic `import()` of user text, or WebAssembly compiled from user input.
   - User source is **data**. It is parsed and then interpreted by our own spec model.
   - *Why: this removes the entire RCE class of bugs instead of trying to contain it.*
2. **Observable results equal real V8.**
   - Anything a real run would show must be byte-identical to the pinned Node/V8 version: console text, callback order, values, thrown error messages, unhandled-rejection output and exit code.
   - If we can't guarantee that for a construct, we **refuse it with a diagnostic**. We never approximate.
   - *Why: a visualizer that teaches wrong behavior is worse than none.*
3. **Honest internals.**
   - Every internal view carries a truth level (§3.2): **Exact**, **Verified model** or **Illustrative**.
   - We never present a model as V8's actual output, and modeled internals never influence Exact results.
   - *Why: learners will repeat what we show them in interviews and at work.*
4. **One source of truth.**
   - Our Ignition-style bytecode is the single program representation, as it is in V8.
   - The interpreter executes it, the baseline compiler translates it, and every artifact traces back to a source position through it.
   - *Why: views derived separately will eventually disagree.*
5. **Deterministic and pure at the core.**
   - `core/` is pure TypeScript with no I/O, no wall clock and no randomness.
   - The same input always produces byte-identical timelines.
   - *Why: this enables time travel, golden tests, caching, and identical behavior in the browser, worker and server.*
6. **Secure by default, defense in depth, least privilege.** Every boundary validates its input. Authorization is enforced next to the data, not only at the routing edge.
7. **Simple first, then optimize with evidence.** Build the smallest design that meets the acceptance criteria. YAGNI applies to everything except security and correctness.
8. **Make illegal states unrepresentable.** Use discriminated unions, branded IDs, exhaustive `switch` with `never`, readonly ticks, and Zod at runtime boundaries.
9. **Smooth by construction.** Per-frame work never goes through React reconciliation. Budgets are 60 fps at 2× playback, and initial JS for `/playground` ≤ 250 KB gzip, excluding lazy chunks.
10. **Accessible and inclusive.** WCAG 2.2 AA, full keyboard control, `prefers-reduced-motion` support, and a non-WebGL fallback.
11. **Small, verified, reversible steps.** Every change ships with tests and passes lint, typecheck and build before it is called done. Evidence comes before claims.
</principles>

---

## 3. The V8 Fidelity Contract

<fidelity>
This section is the heart of the product. Read it before every core phase.

### 3.1 Target

- **Pin one target.** Use the current Node.js LTS. Record the exact `process.versions.node` and `process.versions.v8` in `docs/TARGET.md`. Everything "real" in this document means *that* Node/V8 pair.
- **Upgrading the target** is a deliberate change: bump `docs/TARGET.md`, re-record the conformance expectations (§3.4), and review the diffs.
- **The program model** is exactly what `node main.cjs` does:
  - a CommonJS script, so the module-detection and ESM job-ordering differences can't creep in
  - TypeScript handled the way Node's built-in type stripping does: erase types and replace them with whitespace so positions are preserved
  - TS features that need a transform (`enum`, `namespace`, parameter properties) get a diagnostic, exactly as Node's strip-only mode refuses them
- **Teach the boundary correctly.** V8 owns the language, the heap, compilation and the microtask queue. **Node and libuv own the event loop**: timers, the poll/check phases, and `process.nextTick`. The UI and narration must say so, because "the event loop is part of V8" is a common misconception.

### 3.2 Truth levels (shown as a badge on every pane and view, and documented in `docs/FIDELITY.md`)

| What the learner sees | Level | How it's guaranteed |
|---|---|---|
| Console output text (incl. `util.inspect` formatting of arrays/objects/strings/numbers) | **Exact** | Spec interpreter + our `inspect` reimplementation; differential tests vs pinned Node |
| Order of sync code, nextTicks, microtasks, timers, immediates | **Exact** | Spec job semantics + Node loop model; differential tests |
| Uncaught exception / unhandled rejection output, and the exit code | **Exact** after documented normalization (file path → `main.cjs`) | V8 message templates; differential tests |
| Variable values, object key order, number→string conversion | **Exact** | Spec operations (see §3.3); differential tests |
| AST and scope analysis (hoisting, TDZ, closures) | **Exact** with respect to ESTree and spec scoping | Parser + scope unit tests |
| Ignition bytecode listing | **Verified model** | Same opcode sequence as `node --print-bytecode` for every fixture function; operand differences are listed in `docs/FIDELITY.md` |
| Hidden classes (Maps), transitions, in-object vs backing-store properties, elements kinds | **Verified model** | Fixtures assert against V8 natives (`--allow-natives-syntax`, e.g. `%HaveSameMap`, `%HasSmiElements`, `%HasDoubleElements`, `%DebugPrint`) |
| Inline-cache states (uninitialized / monomorphic / polymorphic / megamorphic), feedback slots | **Verified model** where `%DebugPrint` exposes it; otherwise **Modeled** | Fixture checks |
| Tier-up to Sparkplug / Maglev / TurboFan and deopts | **Modeled** | V8 thresholds are heuristics that change between versions. Show them as "would typically…" and sanity-check with `%GetOptimizationStatus` fixtures |
| Smi vs HeapObject tagging, pointer compression | **Verified model** | Matches V8's documented tagging scheme for the pinned build config |
| Heap addresses, young/old generation occupancy, GC timing | **Illustrative** | Never affects Exact results |
| Machine code (assembly) and register contents | **Illustrative** | Sparkplug-style per-bytecode templates using V8's real x64 register roles (verify against `src/codegen/x64/register-x64.h` for the pinned V8, e.g. accumulator in `rax`, context in `rsi`, root register `r13`). Real V8 code differs in detail |
| Machine-code bytes | **Exact encoding of the shown assembly** | Golden bytes checked against a real assembler (`llvm-mc --show-encoding`) in a dev script |
| CPU caches, ALU, buses (3D) | **Illustrative** | — |

The UI tooltip for each badge explains the level in one sentence. For example: *"Verified model: our reconstruction, checked against real V8 on test programs. Your program's details may differ."*

### 3.3 How we get exact results without executing user code

The interpreter is a **spec model**, not a wrapper around the host engine.
- **Abstract operations are named after the spec,** for example `ToPrimitive`, `ToNumber`, `ToString`, `IsLooselyEqual`, `OrdinaryGet`, `PerformPromiseThen`, `NewPromiseReactionJob`, `NewPromiseResolveThenableJob`, `Await` and `AsyncFunctionStart`.
- **Comments cite the operation name, not the section number,** because section numbers change between editions.
- **The host engine is used only for operations the spec defines bit-exactly:**
  - IEEE-754 double arithmetic
  - `Number::toString` (shortest round-trip)
  - UTF-16 string operations
  - comparisons

  Running `a + b` on two numbers our interpreter holds is computation on data, not execution of user code.
- **Implementation-defined or nondeterministic features are excluded with a diagnostic** that explains why:
  - `Math.random`, `Date.now()`/`new Date()`, and `Math.sin`/`cos`/`exp`/`pow` and the other approximated functions, which can differ between engines and versions
  - `WeakRef`/`FinalizationRegistry`, which are GC-dependent
  - `Array.prototype.sort` with an inconsistent comparator
  - `performance.now`
- **Promise and async semantics are exact,** including the cases most visualizers get wrong:
  - the `await` fast path for native promises, where `await p` takes 1 tick rather than the pre-2019 3
  - resolving a promise with a thenable or promise costs 2 extra jobs (`NewPromiseResolveThenableJob` → `then`)
  - `return await` versus `return` in async functions
  - `Promise.resolve(p)` returning the same promise
  - `.finally` pass-through ticks
  - rejection handling and the "unhandled rejection" check after the microtask drain
- **The Node loop model,** for a CommonJS main script on the pinned version:
  1. The main script runs to completion.
  2. Drain `process.nextTick` completely, then drain V8's microtask queue completely. Repeat until both are empty.
  3. The loop runs the **timers** phase, then pending, poll, **check** (`setImmediate`), and close.
  4. After **each** timer or immediate callback, repeat step 2's drain. This is Node ≥ 11 behavior.
  5. Timer delays are coerced as Node does (`< 1` or non-numeric → 1 ms). Timers with the same expiry run in creation order.
  6. The process exits when nothing is referenced.
- **Honest nondeterminism.** Some orderings are **not** deterministic in real Node, notably `setTimeout(fn, 0)` versus `setImmediate` from the main module. For these, the simulator picks one ordering, **flags it with a visible "Order not guaranteed in real Node" warning**, and explains why. It must never present a coin flip as a rule.
- **Error fidelity.**
  - Thrown errors use V8's exact message templates for the pinned version, for example `TypeError: Cannot read properties of undefined (reading 'x')` and `ReferenceError: x is not defined`. Keep them in one table with fixture coverage.
  - Uncaught output reproduces Node's format: the source line, the caret, `Name: message`, the stack frames, and the `Node.js vX` trailer. The only normalization is the file path.
- **Simulator limits are not JS errors.** The limits are call depth, tick count, virtual time and heap cells. When one is hit, **stop and show a "Simulation limit reached — real Node would continue" notice**. Never fabricate a `RangeError`, because the real stack limit is around 10k frames, not 64.
  - A program that never ends, such as `setInterval` without `clearInterval`, shows the output up to the virtual-time limit with that notice.
  - Never invent an auto-clear.
- **Refuse rather than approximate.** Anything outside §7.1's subset, or any construct whose Exact behavior we can't guarantee, yields a `Diagnostic` with a hint.

### 3.4 How we prove it (with no user code involved)

All of this lives in `tests/conformance/` and `scripts/conformance/`. Those directories are the **only** places allowed to spawn `node`, and ESLint forbids importing them from `app/`, `core/`, `features/` or `server/`. CI also greps the production build for `child_process`, `node:vm` and `eval`, and fails if they appear.

1. **Differential suite.**
   - **Inputs:** repo-owned fixture programs, plus programs **generated** by a grammar-based `fast-check` generator over the supported subset. These are never user submissions.
   - **Real run:** each program runs on the pinned Node using Node's permission model with no grants, a timeout and a memory cap.
   - **Comparison:** our simulator's stdout, stderr and exit code must match byte-for-byte after the documented normalization.
   - **Shrinking:** on a mismatch, `fast-check` shrinks to a minimal program, and that program is committed as a new fixture.
2. **Recorded expectations.** `npm run conformance:record` writes `*.expected.json` next to each fixture, holding stdout, stderr, exit code, Node version and V8 version. `npm test` compares against these files, so CI works without the pinned Node. A scheduled CI job re-records on the pinned Node and fails if anything drifts.
3. **Internals fixtures.** These run with `--allow-natives-syntax` and `--print-bytecode --print-bytecode-filter=<fn>`. The checks are:
   - our bytecode opcode sequence
   - Map identity and transitions
   - elements-kind transitions, for example `PACKED_SMI_ELEMENTS → PACKED_DOUBLE_ELEMENTS → PACKED_ELEMENTS`, and `HOLEY_*` after creating a hole
4. **test262.** Run the in-subset parts of test262 (Promise, async functions, `await`, operators, scoping) through **our interpreter**. In-subset tests must pass 100%. Exclusions are listed with reasons.
5. **Example gallery.** Every built-in example ships with its recorded real-Node output. Verified examples show a **"Matches Node vX (V8 Y)"** badge. User programs show **"Simulated by spec model"** instead, because we never claim per-run verification we didn't do.
</fidelity>

---

## 4. How You Work

<workflow>
**Per phase, follow this loop:**
1. **Explore.**
   - Read the relevant guides in `node_modules/next/dist/docs/` (this Next.js version has breaking changes, as `AGENTS.md` notes) along with the existing code.
   - For V8 behavior, prefer primary sources over memory: v8.dev blog posts and the V8 source for the pinned version (`src/interpreter/bytecodes.h`, `src/objects/map.h`, `src/codegen/x64/register-x64.h`), the ECMAScript spec, and Node's docs on the event loop and `process.nextTick`.
   - Use the Explore subagent for broad sweeps, and don't speculate about code you haven't opened.
2. **Plan.** Use `superpowers:writing-plans` (or plan mode) to produce a short plan listing the files you'll touch and why. For a design question that is genuinely open, ask one focused question instead of guessing.
3. **Implement test-first.** Use `superpowers:test-driven-development` for `core/` and `server/`. For semantics, the failing test is usually a **conformance fixture** with its recorded real-Node expectation.
4. **Verify.**
   - Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.
   - For core phases, also run `npm run conformance`.
   - For UI work, use `next-dev-loop` and/or `webapp-testing` to check the running app in a real browser.
   - Follow `superpowers:verification-before-completion`: never report something as done without command output that proves it.
5. **Review.** Run `/code-review` (or `superpowers:requesting-code-review`) on the phase diff. Run `security-review` on Phases 1, 8 and 9. Fix the findings you agree with and note the ones you reject.
6. **Report and stop.** Commit with Conventional Commits, then report:
   - what was built
   - the verification output
   - deviations from this prompt (also add them to `docs/DECISIONS.md` as short ADRs)
   - any fidelity gaps (also add them to `docs/FIDELITY.md`)
   - open risks

   Then **stop and wait for review**.

**Skills to load when relevant (all available in this environment):**

| When | Skill |
|---|---|
| Product & design context (once, Phase 0) | `impeccable init` → `PRODUCT.md`; then `impeccable shape` per surface |
| Design-system tokens | `ui-ux-pro-max --design-system` (as a starting point only; see §8.1), then `impeccable document` → `DESIGN.md` |
| Building any UI surface | `impeccable` (new-work / craft floor), `frontend-design`, `emil-design-eng` |
| Reviewing a finished surface | `impeccable critique` + `impeccable audit`, then `impeccable detect --json <changed files>` (once per surface) |
| Animating the 2D views | `motion-design` / `animate`, `motion-patterns` |
| Admin charts and KPI tiles | `dataviz` |
| Accessibility pass | `design:accessibility-review` |
| A bug, failing test or conformance mismatch | `superpowers:systematic-debugging` before you try any fix |
| Independent sub-tasks (e.g. bytecode generator vs baseline compiler vs encoder) | `superpowers:dispatching-parallel-agents` / `subagent-driven-development` |

**Working rules:**
- Make independent tool calls in parallel.
- Keep changes scoped to the current phase. If you notice something worth doing, put it under "Open risks / follow-ups".
- Prefer editing existing files to creating new ones. Match the surrounding code style. Comments explain *why*.
- **Settle conflicts by authority:**
  - Real V8 behavior, as shown by a conformance run, beats this document, your memory, and blog posts.
  - An installed library's real behavior beats this document.
  - Record each such deviation in `docs/DECISIONS.md`.
- **Never "fix" a conformance mismatch** by editing the recorded expectation, unless the target version was deliberately bumped.
- At the end of Phase 0, append a short **project section to `CLAUDE.md`** (below `@AGENTS.md`, under 60 lines). It should cover:
  - the commands
  - the directory dependency rule
  - the "never execute user code" invariant
  - the rule that conformance expectations come only from real Node
- Never commit secrets. Never weaken a security control or a fidelity check to make a test pass.
</workflow>

---

## 5. Verified Tech Stack

<stack>
| Concern | Choice | Best-practice notes |
|---|---|---|
| Framework | **Next.js 16.3.x**, App Router, Turbopack (default) | Only async access to `params`, `searchParams`, `cookies()` and `headers()`. Request interception lives in **`proxy.ts`**, which exports `proxy` and runs on Node. Use `npx next typegen` for the `PageProps<'/route'>` helpers. |
| UI runtime | React 19.2 | `useActionState` for forms, `useOptimistic` for snippet saves. Evaluate the React Compiler in Phase 9. |
| Language | TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride` | No `any`. Use `unknown`, then narrow. |
| Styling | **Tailwind v4** (CSS-first `@theme` in `app/globals.css`) + **shadcn/ui** | Semantic tokens as CSS variables. Dark-first with a light theme. |
| 2D motion | **Motion** (`motion` package, `motion/react`) | Replace `framer-motion` with `motion`. Remove `gsap`/`@gsap/react`. Animate `transform`/`opacity` only. |
| 3D | `three` + `@react-three/fiber` 9 + `@react-three/drei` 10 | Load the canvas with `next/dynamic(() => import(...), { ssr: false })`. |
| Editor | **CodeMirror 6** (`@uiw/react-codemirror`, `@codemirror/lang-javascript`) | Read-only instances for the AST, bytecode, asm and hex panes, so all highlighting goes through one API. |
| Parser | **`@babel/parser`** with `plugins: ["typescript", "estree"]`, `errorRecovery: true` | One parser for JS and TS. Write our own scope analysis on top. |
| Client state | **Zustand v5** + `subscribeWithSelector`, `useShallow` | See §7.6. |
| Validation | **Zod v4** | Use it for forms, actions, route handlers, env, and worker messages. Use `.strict()` objects. |
| Database | **MongoDB + Mongoose** | Transactions need a **replica set** (Atlas, Docker `--replSet rs0`, or `MongoMemoryReplSet` in tests). |
| Auth | **iron-session** + **argon2id** | `getIronSession(await cookies(), opts)`; `nextProxyCookies` in `proxy.ts`. Payload: `{ userId, role, sessionVersion }`. |
| Rate limiting | Token bucket behind a `RateLimitStore` interface. Use Redis (`ioredis`) when `REDIS_URL` is set, otherwise in-memory for dev only. | Limits live in a Mongo `settings` doc, with a 30 s cache. |
| Testing | **Vitest** (unit, golden, property via `fast-check`) + **Playwright** + `@axe-core/playwright` + the conformance runner (§3.4) + a vendored test262 subset | — |

Validate the environment once in `server/env.ts` with Zod: `MONGODB_URI`, `SESSION_SECRET` (≥32 chars), optional `REDIS_URL`, `ADMIN_BOOTSTRAP_EMAIL`. Fail fast on boot if anything is invalid. Ship `.env.example`.
</stack>

---

## 6. Architecture

### 6.1 One pipeline, modeled on V8's

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

The interpreter executes the **same** BytecodeArrays the panes display, just as Ignition does. The baseline compiler is a straight per-bytecode template translation, which is how Sparkplug actually works, so the asm pane can't drift from the bytecode.

### 6.2 Directory layout (feature-based, Clean Architecture)

Keep the scaffold's root-level `app/`.

```
app/                                 # routing only: thin pages that compose features
  (marketing)/page.tsx  (auth)/login, register  playground/page.tsx  s/[slug]/page.tsx
  dashboard/  admin/  api/compile/route.ts  api/snippets/...  api/admin/metrics/route.ts (SSE)
proxy.ts                             # optimistic session redirect, security headers, request id

core/                                # PURE TS — no React/Node/DOM imports; runs in browser, worker, server
  frontend/   strip-types.ts  parse.ts  scope/{ScopeAnalyzer,Scope}.ts  subset/validator.ts
  bytecode/   bytecodes.ts (opcode table)  BytecodeGenerator.ts  BytecodeArray.ts
              ConstantPool.ts  FeedbackVectorSpec.ts  SourcePositionTable.ts
  baseline/   BaselineCompiler.ts  templates/  x64/{registers,Encoder,encodings}.ts
  runtime/    spec/ (abstract operations by spec name)  values/ (JSValue, Smi, HeapNumber, String)
              objects/{Map,TransitionTree,JSObject,JSArray,ElementsKind,JSFunction,Context}.ts
              ic/{FeedbackVector,InlineCache}.ts  heap/{Heap,YoungGen,OldGen,Scavenger,MarkCompact}.ts
              builtins/{console,inspect,Promise,Array,Object,String,Number,errors}.ts
              messages.ts (V8 error message templates for the pinned version)
  interpreter/ IgnitionInterpreter.ts  Frame.ts  tiering/TieringModel.ts
  host/       NodeEventLoop.ts (phases, nextTick, timers, immediates)  VirtualClock.ts
  timeline/   Timeline.ts  narration.ts  SimulationEngine.ts
  shared/     result.ts diagnostics.ts ids.ts fidelity.ts (truth-level enum)

features/                            # React feature modules: components/, hooks/, store/
  playground/ (incl. worker/pipeline.worker.ts)  event-loop-2d/  v8-internals/  hardware-3d/
  snippets/  auth/  admin/

server/                              # every file starts with `import "server-only"`
  env.ts  db/  repositories/  auth/{session,dal,permissions}.ts
  security/{rateLimit,csrf,sandbox,headers}.ts  audit/AuditLogger.ts  actions/

tests/conformance/                   # fixtures/*.cjs|*.cts + *.expected.json, generator, runner
scripts/conformance/record.ts        # the ONLY code that spawns real node (pinned, sandboxed)
vendor/test262/                      # in-subset tests only
components/ui/                       # shadcn output
docs/  TARGET.md  FIDELITY.md  SUPPORTED_SUBSET.md  ARCHITECTURE.md  DECISIONS.md
```

**Dependency rule.** Enforce it with ESLint `no-restricted-imports`, so it is checked by tooling rather than by convention:
- `core/` imports only `core/`.
- `features/` imports `core/` and `components/`.
- `app/` imports `features/` and `server/`.
- Nothing imports `app/`, `tests/` or `scripts/`.

**Code bans.** Ban `eval`, `new Function`, `node:vm`, `child_process` and `ShadowRealm` everywhere **except** `scripts/conformance/` and `tests/conformance/`. Those directories need `child_process`, and only to run repo-owned or generated programs.

---

## 7. Module Specifications

### 7.1 Supported language subset → `docs/SUPPORTED_SUBSET.md`

<subset>
**Supported** (each item is backed by fixtures recorded on real Node):
- `let`/`const`/`var` with correct hoisting and TDZ; numbers, strings, booleans, `null`, `undefined`, template literals.
- Arithmetic, comparison (`==` and `===`, with exact coercions), logical, `typeof`, and the `?.`/`??` operators.
- Control flow: `if`/`else`, `for`, `while`, `break`/`continue`, `return`, `throw`, `try`/`catch`/`finally`.
- Functions: declarations, expressions and arrows; closures (context allocation, shown the way V8 does it); recursion; default parameters.
- Arrays: literal, index, `push`, `pop`, `length`, holes, `map`/`filter`/`forEach`/`reduce`. Elements-kind transitions are visible.
- Objects: literals, property get/set/delete, shorthand, methods, `Object.keys`. Hidden-class transitions are visible, and dictionary mode appears after `delete`.
- Classes with fields and methods, as a stretch goal.
- `console.log`/`error`/`warn` with Node's `util.inspect` formatting, implemented for these value types.
- **Async and host APIs:**
  - V8: `Promise` (constructor, `resolve`/`reject`/`all`/`race`/`allSettled`/`any`, `then`/`catch`/`finally`), `async`/`await`, `queueMicrotask`.
  - Node: `process.nextTick`, `setTimeout`/`clearTimeout`, `setInterval`/`clearInterval`, `setImmediate`/`clearImmediate`.
- TypeScript that Node's type stripping accepts. Types are erased with positions preserved, and the "Stripped JS" view shows exactly what V8 receives.

**Excluded, with a diagnostic explaining why** (see §3.3): `Math.random`, `Date`, approximated `Math` functions, `WeakRef`/`FinalizationRegistry`, `performance`, `fetch` and any I/O, `require`/`import`, generators, `eval`-like features, `Proxy`/`Reflect`, `Symbol`, `BigInt`, regex, getters/setters, top-level `await`, and TS `enum`/`namespace`. Excluded features can be added later, one at a time, each with its fixtures.

**Every diagnostic** is `Diagnostic { code, message, range, hint }`, shown inline. Never fail silently.

**Simulator limits.** Hitting one shows the "Simulation limit reached — real Node would continue" notice; it is never presented as a JS error.

| Limit | Value |
|---|---|
| Source size | ≤ 10 KB |
| Lines | ≤ 400 |
| Ticks | ≤ 5,000 |
| Call depth | ≤ 64 |
| Heap objects | ≤ 1,024 |
| Virtual time | ≤ 60 s |
</subset>

### 7.2 Bytecode (the single source of truth)

- **Model V8's Ignition: a register machine with an accumulator.**
  - Opcode names, operand kinds and listing format follow `--print-bytecode` for the pinned V8, for example `LdaSmi [1]`, `Star0`, `Ldar a0`, `Add r0, [0]`, `GetNamedProperty r1, [0], [2]`, `CallProperty1`, `JumpIfFalse`, `SuspendGenerator`/`ResumeGenerator` for `await`, and `Return`.
  - Opcode names change between V8 versions (for example `LdaNamedProperty` was renamed `GetNamedProperty`), so take them from `bytecodes.h` for the pinned version, not from memory.
- **The `[n]` operands are feedback-vector slots.** The interpreter writes IC feedback into them, which drives the IC and hidden-class views.
- **Constant pool and context slots** are modeled the way V8 models them. Closures capture through `Context` objects, not through some invented `Env`.
- **`SourcePositionTable`** maps each bytecode offset to a source range, with expression and statement positions like V8's. Every other mapping in the app (AST node, asm span, byte span, tick) goes through `(functionId, bytecodeOffset)`.
- **Verified model.** For every fixture function, our opcode sequence equals real `--print-bytecode` output after normalization. Known operand-level differences are listed in `docs/FIDELITY.md`.

### 7.3 Baseline compiler & encoder (Strategy pattern)

```ts
interface CodeViewStrategy<TOut extends CodeViewOutput> {
  readonly id: "ast" | "bytecode" | "asm" | "binary";
  emit(program: BytecodeProgram, ctx: EmitContext): TOut;   // pure + deterministic
}
interface CodeViewOutput { readonly lines: readonly EmittedLine[] } // { text, positions: BytecodePos[] }
class CompilationManager {
  compile(source: string, lang: "js" | "ts"): CompilationResult; // { diagnostics, ast, scopes, program, views }
}
```

- **BaselineCompiler (Sparkplug-style, Illustrative).**
  - Translate each bytecode into a fixed x86-64 template that follows V8's x64 conventions: accumulator in `rax`, context in `rsi`, frame via `rbp`/`rsp`, bytecode registers as frame slots, and complex operations as `call` to named builtins (e.g. `call Builtin::kAdd_Baseline`).
  - Look up the register roles in `register-x64.h` for the pinned V8 and cite it.
  - Use AT&T syntax by default, with an Intel-syntax toggle.
- **X64Encoder.**
  - Table-driven, covering only the forms the templates emit (REX, ModRM/SIB, imm32, rel32). Two passes produce real label fixups.
  - Golden bytes: `push %rbp`=`55`, `mov %rsp,%rbp`=`48 89 e5`, `pop %rbp`=`5d`, `ret`=`c3`.
  - A dev script cross-checks every template against `llvm-mc --show-encoding`.
  - An unknown form is a failing test, not a fallback.
- **TieringModel (Modeled).**
  - Counts invocations and loop back-edges per function, then marks "Sparkplug → Maglev → TurboFan" candidates with approximate, labeled thresholds.
  - Shows speculative-optimization assumptions (e.g. "assumes `x` is a Smi") and a deopt event when feedback changes.
  - Optimized machine code is **not** generated. The UI explains that TurboFan output is far too version-specific to show honestly.

### 7.4 Runtime: values, objects, heap (V8 model)

- **Values.**
  - **Smis** are 31-bit with pointer compression, shown tagged (`value << 1`). Anything else is a **HeapObject** with a tagged pointer.
  - **HeapNumber** is used for non-Smi numbers, and the UI shows the moment a number is "boxed".
  - Strings are shown as internalized or not, as a stretch goal.
- **Maps (hidden classes).**
  - A transition tree from the root map, with in-object properties versus a property backing store.
  - The map is deprecated when a field's representation generalizes (Smi → Double → Tagged).
  - **Dictionary mode** follows `delete`.
- **Elements kinds.**
  - The lattice `PACKED_SMI → PACKED_DOUBLE → PACKED` and their `HOLEY_*` counterparts.
  - Transitions are one-way, as in V8.
- **Inline caches.** Per feedback slot: uninitialized → monomorphic → polymorphic (≤4 maps) → megamorphic.
- **Heap.**
  - A young generation (semi-space, Scavenger) and an old generation (Mark-Compact), with promotion after surviving scavenges.
  - GC is triggered by modeled occupancy. Addresses and timing are **Illustrative** and isolated from the Exact layer: a GC event can never change program output.

### 7.5 Interpreter & Node loop (State Machine + Command + time travel)

- `SimulationEngine.run(program): Timeline`. Each bytecode dispatch, job, loop-phase transition and GC event is a Command that records a Tick.
- **Semantics are exactly §3.3:** spec abstract operations, the promise and async job rules, and the Node loop phases with nextTick/microtask drains.
- **Tick** (deeply `readonly`):
  ```ts
  type Tick = {
    index: number;
    phase: "script" | "nextTick" | "microtask" | "timers" | "check" | "loop-transition" | "gc" | "exit";
    pos: { functionId: FunctionId; bytecodeOffset: number } | null; currentLine: number | null;
    callStack: Frame[];                       // function, bytecode offset, registers r0..rn, accumulator, context
    hostApis: HostEntry[];                    // pending timers/immediates with virtual due time
    nextTickQueue: TaskRef[]; microtaskQueue: TaskRef[]; timerQueue: TaskRef[]; immediateQueue: TaskRef[];
    loopPhase: "timers" | "pending" | "poll" | "check" | "close" | null;
    console: ConsoleLine[]; virtualTimeMs: number;
    v8: { maps: MapSnapshot[]; changedMapId?: MapId; feedback: FeedbackSnapshot[];
          elementsKinds: Record<ObjectId, ElementsKind>; tiers: Record<FunctionId, Tier>;
          heap: { young: HeapRegion; old: HeapRegion; lastGc?: GcEvent } };
    machine: { asmLine: number | null; registers: X64Registers; flags: { zf: boolean; sf: boolean; cf: boolean } }; // Illustrative
    cache: CacheState; bus: BusTransfer | null; alu: AluOp | null;                                                  // Illustrative
    warnings: FidelityWarning[];              // e.g. "Order not guaranteed in real Node"
    narration: string;                        // WHY, naming the spec op / V8 mechanism
  };
  ```
  Use `bigint` internally and serialize as hex strings across the worker boundary.
- **Narration** names the mechanism, for example:
  - "`PerformPromiseThen` queued a `PromiseReactionJob`; V8 runs microtasks before Node's timers phase."
  - "Property `y` added → new hidden class `Map#3` (transition from `Map#2`)."
  - "Array went from `PACKED_SMI_ELEMENTS` to `PACKED_DOUBLE_ELEMENTS` because `1.5` isn't a Smi."
- **Timeline storage.** Keep a keyframe every 64 ticks, with patches in between, behind an LRU cache of 256. Budget: ≤ 20 MB for 5,000 ticks.

### 7.6 Client state & view broker (Pub/Sub)

- **Worker.** Compile and simulate in `features/playground/worker/pipeline.worker.ts`, created with `new Worker(new URL(...), { type: "module" })`.
  - Messages are Zod-validated.
  - Debounce by 400 ms, and drop stale results by `jobId`.
  - The worker **interprets** user source; it never evaluates it.
- **Store.** One Zustand store with four slices:
  - `editor` (source, lang, diagnostics)
  - `compile` (views, source position table)
  - `playback` (`index`, `isPlaying`, `speed`, `length`)
  - `hover` (pane, line)

  The timeline lives outside React state in a module ref.
- **Selector hooks** are the only read path:
  - `useCallStack()`, `useQueues()`, `useLoopPhase()`, `useConsole()`, `useV8State()`, `useNarration()`, `useFidelityWarnings()` use `useShallow`.
  - `useHighlightedLines(pane)` merges playback and hover.
- **3D reads without React.** `useHardwareFrame()` reads via `getState()` plus a transient `subscribe`, so playback causes zero React renders in the canvas.
- **Playback.** A `requestAnimationFrame` clock with speeds 0.25×–8×.
- **Keyboard shortcuts:**

  | Key | Action |
  |---|---|
  | `Space` | Play/pause |
  | `←` / `→` | Step back/forward |
  | `Shift+←` / `Shift+→` | Jump to the previous/next loop phase or job boundary |
  | `Home` / `End` | Jump to the first/last tick |

### 7.7 Server: RBAC, security, persistence (Interceptor + Repository)

**Models.**

| Model | Fields | Indexes / notes |
|---|---|---|
| `User` | `email` (unique, lowercased), `passwordHash`, `displayName`, `role`, `status: "active" \| "banned"`, `sessionVersion`, timestamps, `lastLoginAt` | — |
| `Role` | `name`, `permissions: Permission[]` | Seeded; drives `can(user, permission)` |
| `Snippet` | `ownerId`, `title`, `source`, `lang`, `slug` (unique, nanoid 10), `visibility`, `forkedFrom?`, `stats`, timestamps | `{ownerId:1, updatedAt:-1}` |
| `AuditLog` | `at`, `actorId?`, `ipHash`, `requestId`, `event`, `severity`, `details`, `codeHash?` | **TTL 90 days**; `{event:1, at:-1}` |
| `Setting` | `key`, `value` | Rate-limit config |

**Mongo rules.**
- Set `mongoose.set("sanitizeFilter", true)` and `strictQuery: "throw"` globally.
- Only repositories import models, and they return plain domain types (`.lean()` + map).
- Multi-document writes use `session.withTransaction`.
- Cache the connection on `globalThis` so it is HMR-safe.

**Auth layers (defense in depth).** These follow the bundled `data-security.md` guide.
1. **`proxy.ts`.** An optimistic cookie-presence check only, plus security headers and `x-request-id`. **No DB access.**
2. **`server/auth/dal.ts`.** `getCurrentUser()`, `requireUser()` and `requireRole("admin")`, wrapped in React `cache`. They check `status` and `sessionVersion`. Call them in every protected page or layout, every Server Action, and every Route Handler.
   - Use `forbidden()`/`unauthorized()` only after enabling the experimental `authInterrupts` flag, and record that decision.
3. Return DTOs only. Use `taintUniqueValue` on the session secret.

**RBAC matrix.**

| Permission | anon | user | admin |
|---|---|---|---|
| compile & simulate (separate rate limits) | ✓ | ✓ | ✓ |
| snippet: create / update / delete own, share, fork | — | ✓ | ✓ |
| snippet: moderate any | — | — | ✓ |
| user: list / ban / change role (not self, not the last admin) | — | — | ✓ |
| audit:read, metrics:read, ratelimit:configure | — | — | ✓ |

**Auth best practices.**
- argon2id (m=19 MiB, t=2, p=1 per OWASP).
- Generic login errors, to prevent account enumeration.
- Constant-time comparison.
- Per-IP+email login limit.
- Regenerate the session on login.
- Bump `sessionVersion` on password change, ban or role change.

**Input validation.**
- One Zod schema per action or route, using `.strict()`.
- Code ≤ 10 KB. Reject NUL and control characters other than `\n\t\r`.
- Validate `slug`/`id` formats before they reach any query.

**Rate limits** (token bucket, keyed by userId, falling back to a hashed IP):

| Scope | Limit |
|---|---|
| Compile, anonymous | 20/min |
| Compile, user | 60/min |
| Auth | 5/min per IP+email |
| Snippet writes | 30/min |

Responses are `429` with `Retry-After`. Every limit hit is audit-logged.

**CSRF.**
- Server Actions get Next's built-in Origin/Host check.
- Mutating Route Handlers check `Origin` and also use a double-submit token.
- Cookies are `sameSite=lax`.

**Sandbox.** `/api/compile` runs the same pure `core/` **interpreter** in a `worker_threads` pool, with `resourceLimits` (64 MB) and a 2 s wall-clock timeout. This guards against pathological parses or interpreter loops. It is **not** a sandbox for running user code, because user code is never run.

**Headers.**
- Nonce-based CSP with `worker-src 'self' blob:` and **no `'unsafe-eval'`**. That makes the "never execute" rule hold at the browser level too.
- `frame-ancestors 'none'`, `nosniff`, `strict-origin-when-cross-origin`, a minimal `Permissions-Policy`.

**AuditLogger.**
- Applied through `withAudit(fn, { event })` wrappers.
- Events:
  - `auth.*`, `rbac.denied`, `ratelimit.hit`
  - `compile.rejected`, `compile.slow`, `sandbox.timeout`
  - `snippet.moderated`, `user.role_changed`, `user.banned`
- Store a `codeHash`, never raw code.
- Logging is fire-and-forget through a bounded queue.

---

## 8. UI / UX Specification

<ui>
### 8.1 Design direction

Sources: the `impeccable` and `ui-ux-pro-max` skills, adjusted for this product.

**Design mode per surface.**

| Surface | Mode | Means |
|---|---|---|
| `/playground`, `/dashboard`, `/admin` | **Operate** | Familiar, dense, fast. The tool disappears into the task. |
| Landing page | **Persuade** | One bold moment: a live mini-visualizer resolving "Promise vs setTimeout" in the hero. |
| `/docs`, the subset reference, and the fidelity page | **Read** | 65–75ch measure, clear structure. |

**Style.** "Dark Mode (OLED)" developer tool:
- Deep slate background, a second neutral layer for panels, and glow only on *active* elements.
- Dark-first with a light theme. Every color is a semantic token, and both themes reach 4.5:1 text contrast.

**Color.** Restrained, so accents mean something:

| Role | Color |
|---|---|
| Primary action / current tick | Green |
| Microtask (V8) | Violet |
| nextTick (Node) | Violet outline + "nextTick" label |
| Timers / immediates (Node macrotasks) | Amber, with phase labels |
| Host APIs (libuv) | Cyan |
| Error | Red |
| Fidelity warning | Yellow |

Color is always paired with a label or icon.

**Truth-level badges.** Every pane and view shows its §3.2 level as a quiet badge with a tooltip:
- **Exact:** neutral, with a check icon.
- **Verified model:** neutral, with a flask icon.
- **Illustrative:** muted, with a sketch icon.

Badges are never loud. They are trustworthy fine print.

**Type.**
- **IBM Plex Sans** for UI text, on a fixed rem scale with a 1.125–1.2 ratio.
- **JetBrains Mono** only for code, bytecode, assembly, hex, registers and addresses, with tabular numerals.
- Load both with `next/font`.

**Icons.** Lucide only. No emoji as icons. Icon-only buttons need `aria-label` and a tooltip.

**Record it.** After Phase 6, use `impeccable document` to write `DESIGN.md`.

**Rejected suggestions.** GSAP stagger with `back.out` overshoot, and orchestrated page-load sequences.

### 8.2 Component & interaction floor

- **States.** Every interactive component has default, hover, focus-visible, active, disabled, loading and error states.
- **Loading.** Use skeletons, not centered spinners, and keep CLS below 0.1.
- **Empty states teach.** An empty editor offers the examples. An empty dashboard explains what saving a snippet does.
- **Errors sit next to their cause.** Diagnostics appear inline and in a problems list. Each "excluded feature" diagnostic links to the fidelity docs that explain why.
- **Overlays.** Overlays portal out of `overflow` containers. Modals are a last resort, and destructive confirms name the target.
- **Motion timing.** Most UI transitions take 150–250 ms. Exits are faster than entrances. Motion conveys state only.
- **Targets.** At least 44×44 px on touch devices, with 8 px or more between them.
- **Command palette (`⌘K`):** Run, Examples, Go to tick, Toggle 3D, and "Show stripped JS".
- **Deep links.** `/s/abc?t=42` links to an exact moment.
- **Onboarding.** A 3-step, dismissible coach mark.

### 8.3 Surfaces

**Layout (≥1280 px).** A resizable three-region IDE built with shadcn `Resizable`.
- **Left: editor.** JS/TS toggle, examples, and inline diagnostics. The examples are:
  - "Promise vs setTimeout"
  - "nextTick vs Promise"
  - "async/await ordering"
  - "await a thenable (the 2 extra ticks)"
  - "setTimeout 0 vs setImmediate (nondeterministic!)"
  - "hidden classes: same shape vs different order"
  - "elements kinds: SMI → DOUBLE → HOLEY"
  - "closure context"
  - "recursive factorial"
  - "uncaught TypeError"

  Each example shows its "Matches Node vX" badge.
- **Right: tabs AST | Bytecode | Machine Code.**
  - AST shows the tree and the scope chain.
  - Bytecode is the `--print-bytecode`-style listing, with feedback slots that link to the IC view.
  - Machine Code shows asm with a Hex/Binary toggle.
  - The playback position gets a solid highlight; hover gets an outline.
- **Bottom (collapsible): tabs Event Loop (2D) | V8 Internals | Hardware (3D).** It also holds the playback bar (with phase-colored scrubber markers and fidelity-warning markers) and the narration line.
- **Narrower screens.** Tablet and mobile stack the panes behind a segmented control. 3D is off by default on mobile.

**2D Event Loop (Motion).**
- Regions:
  - the Call Stack
  - Host APIs (libuv)
  - the nextTick queue
  - the Microtask queue, labeled "owned by V8"
  - the Timers queue and the Check (setImmediate) queue
  - a phase ring (timers → pending → poll → check → close) labeled "owned by Node/libuv"
- Tasks share a `layoutId` so a callback visibly travels between regions.
- Stack frames use spring enter (`stiffness: 500, damping: 32`, no overshoot) and fade-up exit inside `AnimatePresence mode="popLayout"`.
- A nondeterministic ordering shows a yellow warning chip on the affected tasks.
- Under reduced motion, changes are instant.

**V8 Internals view.**
- **Frame inspector.** The accumulator and registers `r0..rn`, shown as tagged values with a Smi/HeapObject marker.
- **Hidden-class graph.** The transition tree, with the current object's map highlighted and dictionary-mode maps visually distinct.
- **IC table.** One row per feedback slot, with its state and the maps it has seen.
- **Elements-kind lattice.** The current kind is highlighted, and the arrows are one-way.
- **Heap strip.** Young (from/to semi-spaces) and old generations, with scavenge and promotion animations.
- **Tier timeline per function.** Ignition → Sparkplug → Maglev → TurboFan, with deopt markers.
- Each panel carries its truth badge.

**3D Hardware board (R3F).**
- **Performance rules:**
  - no `setState` in `useFrame`; mutate refs, scaled by `delta`
  - `InstancedMesh` for memory cells with `setColorAt`
  - shared geometries and materials, disposed on unmount
  - `frameloop="demand"` while paused, plus `invalidate()` on tick change
  - `<AdaptiveDpr>` and `<PerformanceMonitor>`
- **Contents:**
  - a CPU die whose register bank uses V8's real register roles as labels (`rax = accumulator`, `rsi = context`, …)
  - an ALU, L1/L2, and RAM split into stack, young-gen and old-gen regions
  - bus pulses colored by fetch, read or write
  - flashes on change, and cache hits in green versus misses in red
- The whole board is badged **Illustrative**.
- **Fallback.** A 2D SVG board driven by the same selectors.

**Accessibility.**
- Every control is keyboard-reachable with visible focus.
- An `aria-live="polite"` region speaks the narration.
- Color is never the only signal.
- Run an axe pass for WCAG 2.2 AA.

**Admin (`/admin`).**
- KPI tiles: active users, compiles/min, p95 compile ms, rate-limit hits, sandbox timeouts.
- An SSE live chart.
- A users table with ban and role change behind confirms.
- Snippet moderation.
- An audit viewer with filters and cursor pagination.
- A rate-limit editor.
</ui>

---

## 9. Phases

Every phase follows the workflow in §4 and ends with a report and a stop.

### Phase 0 — Foundation
- Dependencies: swap `framer-motion` for `motion`, remove `gsap`, add the §5 stack, and init shadcn for Tailwind v4.
- Config: tsconfig strict flags, ESLint boundaries + bans (with the conformance exception), Vitest + Playwright, and the scripts `typecheck`, `test`, `e2e`, `conformance`, `conformance:record`.
- Environment: `server/env.ts`, `.env.example`, and `docker-compose.yml` with a Mongo replica set and optional Redis.
- Docs: the `CLAUDE.md` section; `docs/ARCHITECTURE.md` (§6 diagram); `docs/TARGET.md` (pinned Node/V8 versions); and a `docs/FIDELITY.md` skeleton holding the §3.2 table.
- Design context: run `impeccable init` with the human to write `PRODUCT.md`, then put the token starting point in `app/globals.css` `@theme`.

**Done when:**
- `lint`, `typecheck`, `test` and `build` all pass, and `/playground` renders a placeholder.
- Importing `server/` from `core/` fails lint.
- `child_process` in `core/` fails lint.
- The production build contains no `eval`/`child_process`/`vm`.

### Phase 1 — Data, Auth, RBAC, Security
- Data: connection, models, repositories, and a seed.
- Auth: iron-session + argon2 actions, the DAL, `proxy.ts`.
- Security: rate limiter (both stores), CSRF, headers (CSP without `unsafe-eval`), AuditLogger, and `/api/compile` (Zod → rate limit → worker pool → stub → audit).

**Done when:** integration tests on `MongoMemoryReplSet` cover:
- register and login, including the generic error
- rejection of a banned user
- revocation through `sessionVersion`
- a 403 for a user on an admin action
- a 429 once the bucket is empty
- a transaction rollback
- an operator-injection attempt (`{"$ne":null}`) being neutralized
- an audit row for `rbac.denied`

### Phase 2 — Conformance harness, front end, bytecode
Build the **harness first**, because it is the correctness backbone:
- the recorder (pinned Node, permission model with no grants, timeout, memory cap)
- `*.expected.json` files
- the comparison runner
- the `fast-check` program generator over the subset, with shrinking
- the test262 subset runner

Then build type stripping → parse → scope analysis → subset validator → BytecodeGenerator (constant pool, feedback slots, `SourcePositionTable`) → the AST and Bytecode views. Write `docs/SUPPORTED_SUBSET.md`.

**Done when:**
- About 40 fixtures are recorded from real Node, covering every subset feature and every §3.3 tricky case.
- The bytecode opcode sequence matches `--print-bytecode` for every fixture function, with documented exceptions only.
- Scope tests cover hoisting, TDZ and context allocation.
- Unsupported or excluded syntax yields a diagnostic with the correct range and a hint.

### Phase 3 — Interpreter, runtime model, Node loop (exactness)
Build the IgnitionInterpreter over our bytecode, the spec abstract operations, the builtins (including `inspect` and the V8 message templates), the Map/IC/elements-kind/heap model, the Node event loop with nextTick, and the timeline with narration.

**Done when:**
- **100% of fixtures match real Node byte-for-byte** (stdout, stderr, exit code).
- The differential generator runs ≥ 1,000 generated programs with **zero mismatches**.
- In-subset test262 passes 100%.
- The Map, elements-kind and IC fixtures agree with V8 natives.
- Two runs produce deep-equal timelines.
- Every limit produces the "real Node would continue" notice, never a fake JS error.
- The nondeterministic-ordering fixture produces a fidelity warning.
- A 5,000-tick timeline stays under 20 MB.

### Phase 4 — Baseline machine code & tiering model
Build the Sparkplug-style BaselineCompiler templates, the X64Encoder, the `llvm-mc` cross-check script, the TieringModel with deopt events, and the Machine Code view.

**Done when:**
- The encoder golden tests pass, and every template matches `llvm-mc`.
- Every emitted asm and byte line maps to a bytecode offset (a `fast-check` property).
- Register roles cite `register-x64.h` for the pinned V8.
- Tiering is shown only with Modeled badges.

### Phase 5 — Client state broker & worker
Build the worker, the store, the selector hooks, the rAF clock and the shortcuts.

**Done when:**
- Render-count tests show that changing `index` re-renders only subscribed components.
- The 3D hook causes zero renders during playback.
- Stale jobs are dropped.

### Phase 6 — IDE UI + 2D Event Loop
Run `impeccable shape`, then build with `impeccable`, `frontend-design`, `emil-design-eng` and `motion-design`. Build the layout, the synchronized panes, the examples with verified badges, diagnostics, the playback bar with fidelity markers, narration, the 2D loop, the command palette, onboarding, and reduced-motion support.

**Done when:**
- `impeccable critique` + `audit` findings are fixed in one batch.
- `impeccable detect` is clean, or every remaining finding is justified.
- The surface is checked at 375, 768, 1280 and 1440 px.
- `DESIGN.md` is written.
- A Playwright run:
  - steps through "nextTick vs Promise" and asserts queue contents and the console order, which must equal the recorded real-Node output
  - hovers a bytecode line and confirms the source, AST and asm highlights
  - checks that the setImmediate example shows the nondeterminism warning
  - passes axe
  - shows no CLS during playback

### Phase 7 — V8 Internals view + 3D Hardware
Build the frame inspector, hidden-class graph, IC table, elements-kind lattice, heap strip and tier timeline. Then build the R3F board and the SVG fallback.

**Done when:**
- The "hidden classes" and "elements kinds" examples show transitions that match their V8-natives fixtures.
- The 3D view holds a steady ~60 fps at 2× (measured with `r3f-perf`).
- No React renders happen per tick.
- The fallback renders with WebGL disabled.

### Phase 8 — Snippets, sharing, admin
Build snippet CRUD, fork and visibility; the `/s/[slug]` permalink (async `params`, OG metadata); the dashboard; and admin with SSE metrics (use the `dataviz` skill).

**Done when** e2e covers:
- save → share → open while logged out → fork
- an admin ban taking effect on the user's next request
- the audit viewer showing every event involved

### Phase 9 — Hardening & polish
- Load-test `/api/compile`.
- Fuzz the parser and interpreter: no crash, and nothing runs longer than 2 s.
- Run the differential generator at ≥ 10,000 programs.
- Review the CSP and run `security-review`.
- Check the bundle budget and run Lighthouse.
- Evaluate the React Compiler.
- Write the README: architecture, the fidelity contract, and "how to add a language feature end-to-end (fixture → bytecode → interpreter → view)".

---

## 10. Coding Standards

- `core/` uses `Result<T, Diagnostic[]>` for expected failures. Throw only for programmer errors, never to model a JS exception. JS exceptions are interpreter values.
- Use branded IDs (`FunctionId`, `MapId`, `ObjectId`, `TaskId`, `UserId`, `SnippetId`), and exhaustive `switch` with `never` on opcodes, tick phases and elements kinds.
- Name things after **V8 and the spec**: `BytecodeArray`, `FeedbackVector`, `Map`, `ElementsKind`, `PromiseReactionJob`. Don't invent names where V8 already has one.
- Comments cite the spec abstract operation, the V8 source file, or the Node doc that a behavior relies on.
- Server Components by default. `"use client"` only on interactive leaves. No secrets in client bundles.

## 11. Definition of Done (project)

All phase criteria pass. A new learner opens `/playground`, picks "nextTick vs Promise", and presses Play. The console prints **exactly** what real Node prints. The learner *understands why*: the 2D view shows Node draining nextTicks before V8's microtask queue, the narration names the mechanism, the bytecode and asm highlights follow along, and the badges say what's exact and what's illustrative.

They then open "hidden classes" and watch two objects get the same or different Maps, as V8 would. They save and share the snippet. An admin sees the activity in the dashboard and the audit log. And at no point did any real engine execute a line the learner typed.
