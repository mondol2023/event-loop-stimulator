# Phase 3: Interpreter, Runtime Model, Node Loop (Exactness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the Phase 2 `BytecodeProgram` with a spec-model Ignition interpreter, a V8 object, IC and heap model, and Node's event loop. The output must match real Node 24.19.0 byte for byte on every fixture, on ≥ 1,000 generated programs and on the vendored test262 subset. Every run also produces a deterministic, compact timeline with narration, and `/api/compile` runs this real pipeline under `next start`.

**Architecture:** There are three layers, matching who owns what in real Node.
- **V8 side.** `core/runtime/` holds values, objects, Maps, ICs, the heap, the spec abstract operations, the builtins and the microtask queue. `core/interpreter/` holds the `IgnitionInterpreter`, which dispatches over the same `BytecodeArray`s the bytecode pane prints.
- **Node side.** `core/host/` holds the loop, `process.nextTick`, timers, immediates, unhandled-rejection processing, the console streams and Node's error printer. It plugs into V8 through a narrow `HostHooks` interface, the way an embedder does.
- **Timeline.** `core/timeline/` turns every interpreter and host step into a `Command`, which records a `Tick`. Ticks are stored as keyframes plus patches.

The conformance harness from Phase 2 is the judge throughout. A mismatch is a bug in the model, never a reason to edit an expectation.

**Tech Stack:** Pure TypeScript in `core/`. Vitest 5 with `fast-check` 4. `@babel/parser` with the `v8intrinsic` plugin for natives mode (test-only). Zod via `@/core/shared/zod`. `esbuild` becomes a direct devDependency only if Task 24's fallback is needed.

**Spec:** `PROMPT.md` §2, §3 (read it before every core task), §6.1, §7.1, §7.4, §7.5, §7.7 (Sandbox) and §9 Phase 3. Where `docs/DECISIONS.md` (ADR-001 to ADR-024) conflicts with PROMPT.md, the ADR wins. `docs/FIDELITY.md` and `tests/conformance/test262/harnessContract.md` are binding.

## Verified facts (probed on the pinned Node 24.19.0 / V8 13.6.233.17-node.51; do not re-derive)

- **Uncaught error stderr.** The shape is `main.cjs:<line>\n<source line>\n<caret line>\n\n<Name>: <message>\n    at …\n\nNode.js v24.19.0`, with exit code 1.
  - The caret line marks the *throw position*. For `throw new Error(…)` that is the `throw` keyword (`  ^` at column 2). For `o.x` it is the property name.
  - Stack frames point at the *construction position* of the Error. For `new Error(…)` that is the `new` token. For a property-load TypeError it is the property name.
  - For an unhandled rejection of an Error, the caret line points at the Error's construction site: `Promise.reject(new Error(…))` puts the caret under `new`.
- **Stack traces hold at most 10 frames in total, Node-internal frames included** (`Error.stackTraceLimit`). For example, `uncaught-type-error` has 3 user frames and 7 loader frames, and 20 recursive calls print 10 `at r` frames and no internal ones.
- **Frame naming (probed):**
  - top level: `at Object.<anonymous> (main.cjs:L:C)`
  - a plain call: `at readX (main.cjs:L:C)`
  - a method: `at Object.m (…)`
  - an anonymous arrow in a nextTick or microtask: `at main.cjs:L:C` (no name, no parentheses)
  - an arrow in `setTimeout`: `at Timeout._onTimeout (…)`
  - a named function in `setInterval`: `at Timeout.tick [as _onTimeout] (…)`
  - `setImmediate`: `at Immediate.<anonymous> (…)`
  - an async function after its first `await`: only `at f (…)`
  - an async function before its first `await`: `at f` followed by the caller's frames
- **Node-internal frame tails.** These are constants of the pinned target, recorded verbatim.
  - main script: the 7 loader frames ending `at node:internal/main/run_main_module:33:47`
  - nextTick: `at process.processTicksAndRejections (node:internal/process/task_queues:85:11)`
  - microtask and `queueMicrotask`: none
  - timers: `at listOnTimeout (node:internal/timers:635:17)` and `at process.processTimers (node:internal/timers:571:7)`
  - immediates: `at process.processImmediate (node:internal/timers:534:21)`
- **Non-Error throws and rejections.**
  - `throw "str"` uncaught prints the code frame, then the inspected value, then ``(Use `node --trace-uncaught ...` to show where the exception was thrown)``.
  - `Promise.reject(42)` unhandled prints a code frame at `node:internal/process/promises:392`, then `UnhandledPromiseRejection: This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). The promise rejected with the reason "42".`, then 3 internal frames, then ` {\n  code: 'ERR_UNHANDLED_REJECTION'\n}`. Record it as a fixture; never hand-write it.
- **`TimeoutOverflowWarning`.** Each overflowing delay prints `(node:PID) TimeoutOverflowWarning: <n> does not fit into a 32-bit signed integer.\nTimeout duration was set to 1.` The ``(Use `node --trace-warnings ...` …)`` line follows **only the first** warning of the process (`timer-overflow-warning`).
- **TS refusals.** Node's stderr for the refused `.cts` fixtures is an `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` code frame from Node's internal TypeScript loader, which the simulator cannot and should not reproduce (see Decision D1).
- **IC states are observable.** Run with `--allow-natives-syntax --no-lazy-feedback-allocation`. `%DebugPrint(fn)` then prints its feedback vector, with lines such as ` - slot #0 LoadProperty POLYMORPHIC`, ` - slot #2 LoadKeyed MONOMORPHIC`, ` - slot #0 SetNamedSloppy MONOMORPHIC`, ` - slot #5 LoadProperty UNINITIALIZED {` and ` - slot #0 LoadProperty MEGAMORPHIC {`. Five shapes make a load megamorphic. Addresses vary between runs. Without `--no-lazy-feedback-allocation` a function called twice has **no** feedback vector.
- **Maps.** `%HaveSameMap({x:1,y:2}, {x:"string",y:[1]})` is `true` in 13.6, so representation generalization is in place there and is not a new Map (`maps-same-shape-vs-order`). `delete` of the last-added property leaves fast mode in this fixture (`false false`). The model follows the fixture, not PROMPT.md §7.4's "deprecated" wording (Decision D5).
- **Field generalization (fixture `maps-field-generalization`, Task 2) refines the line above.** After `a.f = 1.5` on `{f:1}`, `a` no longer shares a Map with its Smi sibling `b` (`false`), yet a freshly created `{f:3}` shares `a`'s new Map (`true`) and not `b`'s. The sibling `b` matches again only after its own field generalizes (`b.f = {}`: `true true`). So Smi → Double *does* produce a new Map in this scenario (the old one is deprecated and objects migrate lazily). Task 4 must model this and not "generalize in place"; D5's wording needs correcting in the ADR.
- **Nested timers (fixture `timer-in-timer-ordering`).** Observed in 50 runs: `A C A1 A0 B` (46) and `A C B A1 A0` (4), so it is recorded as nondeterministic.
- **Babel.** `@babel/parser` with `plugins: ["estree", "v8intrinsic"]` parses `%HaveSameMap(a, b)` as a call whose callee is a `V8IntrinsicIdentifier` named `HaveSameMap`.
- **Tooling.** `esbuild` and `rolldown` are present in `node_modules` as transitive dependencies only. The Next 16.3 docs say nothing about bundling `worker_threads` entries.
- **The Phase 2 pipeline today.** `closure-in-loop-let` and `bc-loop-let` get **no program** (`E_NOT_YET_SUPPORTED: ForStatement is not compiled to bytecode yet`, for per-iteration `let` contexts), so they cannot run until Task 12. The three `ts-*-refused` fixtures are refused by design. Every other fixture compiles.

### Outcomes measured while executing this plan (added in Task 25)

- **D4 gate.** With one tick per dispatch, `recursion-factorial` needed 28,491 ticks, so the owner chose statement-level ticks (ADR-028). Now the highest program fixture is `recursion-factorial` at 4,880 ticks (120 under the limit); the next is 495. The highest of 1,902 vendored test262 runs is 298.
- **D3 additions.** The `output` (1 Mi chars) and `strings` (8 Mi chars) limits were added after a ~100-byte string-doubling program ran the compile worker out of heap and aborted the server process (ADR-027).
- **D5.** Smi → Double does produce a new Map (the fixture `maps-field-generalization`); the plan's "generalizes in place" wording was right only for Tagged (ADR-029).
- **Task 24 spike.** Path 1 failed (Turbopack copies the TypeScript worker entry unbundled); path 2 (`esbuild` prebuild into `server/security/sandbox/dist/compile-worker.mjs`) shipped (ADR-032).
- **Nondeterminism.** Three rules, three fixtures: `timeout-vs-immediate-main`, `timer-in-timer-ordering`, `timer-after-first-write` (`FIDELITY.md`).
- **Bytecode ratchet.** After Task 12: 82 `exact`, 4 `opcodes`, 1 `pending` of 87. At the end of the phase: 83 / 4 / 1 of 88.

## Global Constraints

- **Never execute user code.** `core/` interprets bytecode. No `eval`, `Function`, `vm`, `ShadowRealm` or `child_process` outside `scripts/conformance/**` and `tests/conformance/**` (ADR-008).
- **The host engine is used only for the bit-exact operations in §3.3:** IEEE-754 arithmetic, `Number::toString`, UTF-16 string operations and comparisons on values the interpreter holds.
- **`core/` stays pure.** It imports only `core/` and pure npm libraries, with no clock, randomness, I/O or DOM. The same input gives byte-identical results.
  - `Result<T, Diagnostic[]>` covers expected failures.
  - A JS exception is an interpreter value (`Completion`), never a TS `throw`.
  - The only TS throws allowed are programmer errors and `SimulationHalt`, which Decision D3 defines.
- **Expectations.** `*.expected.json` is written only by `npm run conformance:record` on the pinned runtime. Never hand-edit one. Use `superpowers:systematic-debugging` on every mismatch.
- **Naming and types.**
  - Names follow V8 and the spec: `JSObject`, `FeedbackVector`, `ElementsKind`, `PromiseReactionJob`, `PerformPromiseThen`.
  - Comments cite the spec abstract operation, the V8 source file (`src/objects/map.h`, `src/ic/ic.cc`) or the Node source (`lib/internal/process/task_queues.js`, `lib/internal/timers.js`), never section numbers.
  - The hidden-class class is `V8Map`: a class named `Map` would shadow the ES `Map` inside the module. The UI and narration still say "Map".
- **Exhaustive `switch` with `never`** over `Opcode`, `ElementsKind`, `TickPhase`, `Command["kind"]` and `IcState`. Use branded ids: `ObjectId`, `MapId`, `TaskId`, plus the existing `FunctionId`.
- **Limits (§7.1):**

  | Limit | Value |
  |---|---|
  | Ticks | 5,000 |
  | Call depth | 64 |
  | Heap objects | 1,024 |
  | Virtual time | 60,000 ms |

  Hitting a limit stops the run with the notice `Simulation limit reached — real Node would continue`, **never** a JS `RangeError`.
- **Test gating.** Tests that need the pinned Node use `describe.skipIf(!pinned)` with a printed reason.
- **Commits.** One commit per task, using Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan makes (each becomes an ADR in Task 25, starting at ADR-025; flag them for human review)

- **D1: Refused fixtures are judged by refusal, not by stderr bytes.** A fixture with `meta.expect: "refused"` passes when all three hold:
  - real Node exited non-zero
  - the simulator refuses with exit code 1 and stderr lines `<code>: <message>` (the test262 contract's format)
  - the code equals the fixture's new `meta.diagnostic` (for example `E_TS_UNSUPPORTED`)

  *Why:* principle 2 says "refuse rather than approximate". Node's loader-internal frames for a refusal are not program behavior. ADR-024 already treats `SyntaxError` text the same way.
- **D2: Natives mode and feedback extraction make `internals` fixtures comparable by bytes.**
  - `CompilationManager.compile(source, lang, { natives: true })` enables Babel's `v8intrinsic` plugin. It compiles `%Name(args)` to `CallRuntime [Name]`, which is what V8 does under `--allow-natives-syntax`, for an allowlist: `HaveSameMap`, `HasFastProperties`, `HasSmiElements`, `HasDoubleElements`, `HasObjectElements`, `HasHoleyElements`, `HasDictionaryElements` and `DebugPrint`.
  - **The option is unreachable from user input.** It is not part of `CompileInput`, the worker message schema or any UI path, and a test proves it.
  - A new fixture meta key, `extract: "feedback"`, makes the recorder keep only the `%DebugPrint` lines that name the function (`<SharedFunctionInfo NAME>`) and the property-IC slots, normalized to `function NAME` / `slot #N KIND STATE`. The slot kinds kept are `LoadProperty`, `LoadKeyed`, `SetNamedSloppy`, `SetNamedStrict`, `SetKeyedSloppy`, `SetKeyedStrict` and `DefineNamedOwn`.
  - Our `%DebugPrint` prints exactly those normalized lines.
  - Recording with `--no-lazy-feedback-allocation` matches our eager feedback model. Real V8's lazy allocation is a documented gap in FIDELITY.md.
- **D3: How a run stops.** `SimulationStop` is one of two kinds:
  - `{ kind: "limit", limit: "ticks" | "callDepth" | "heapObjects" | "virtualTime" | "work" }`
  - `{ kind: "unsupported", reason }`

  An unsupported stop happens when execution reaches behavior whose exact output we cannot guarantee and which compile time cannot catch. For example, `console.log` with a `%j`, `%o` or `%O` directive, or an `Error.stack` frame shape no fixture covers.

  Internally the interpreter throws a `SimulationHalt` error that only `SimulationEngine` catches. Output up to that point is kept, and the notice goes to `warnings` and `stop`, **never** to stdout or stderr.

  The `work` limit (1,000,000 element visits inside builtins, such as a `map` over `length = 2**32-1`) is an addition to §7.1. Real Node would continue there too, so the "real Node would continue" wording stays true.
- **D4: Tick granularity follows §7.5.** One Tick per bytecode dispatch, job start, loop-phase transition, GC event and exit.
  - **Measurement gate (Task 19):** count dispatch ticks for every program fixture and every vendored test262 test. If any needs more than 5,000, **stop and ask the human**. The options are statement-level ticks or a different limit, and neither may be chosen silently.
  - Phase 3's `Tick` omits `machine`, `cache`, `bus` and `alu` (Phase 4/7, Illustrative) and `v8.tiers` (Phase 4 TieringModel). Each later phase adds its field.
- **D5: Maps follow real V8 13.6, not PROMPT.md §7.4's wording.**
  - Field representation generalizes in place (Smi → Double → Tagged) without a new Map, and only when a fixture shows it.
  - Dictionary mode follows `delete` as the fixture shows.
  - A field-generalization case is added to the internals fixtures (Task 2), so the claim has evidence.
- **D6: Size and storage of the timeline.**
  - Ticks share unchanged sub-objects with their predecessor (structural sharing).
  - `TimelineStore` keeps a full keyframe every 64 ticks and, in between, a patch of the top-level `Tick` keys whose reference changed. It serves `at(i)` through an LRU of 256 materialized ticks.
  - "≤ 20 MB" is measured as the UTF-8 byte length of the serialized store (what crosses the worker boundary).
- **D7: Test-only host modes.** `SimulationOptions.host` is `"node"` (the default, and the only mode reachable from user input) or `"test262"`.
  - `"test262"` adds `assert`, `Test262Error`, `$DONOTEVALUATE`, `$DONE` and `print` exactly as `harnessContract.md` specifies.
  - Like natives mode, it is not reachable from any schema.
- **D8: `/api/compile` returns a summary, not the timeline.** The response is `{ diagnostics, output?: { stdout, stderr, exitCode }, warnings, stop?, tickCount }`, validated by a `.strict()` Zod schema. The client builds its own timeline in its Web Worker (Phase 5). This keeps the response small and keeps the audit free of code.

## Review Focus (inputs the spec implies but the done-when list does not exercise)

1. **Re-entrancy through builtins.** `[1,2].map(x => { throw … })`, `reduce` with an `await` inside an async callback, or a `then` callback that schedules a `nextTick`.
   - An exception must unwind through the builtin frame with the handler table intact, and the stack trace must show the right frames.
   - Covered in Task 14 by fixture `builtin-callback-throws` (Task 2).
2. **A program that would spin inside one builtin**, such as `const a = []; a.length = 4294967295; a.map(f)` or `a.forEach` over a huge holey array. It must stop with the `work` limit notice, never hang the browser worker. Covered in Task 18.
3. **`console.log` format directives.** `console.log("100%", 5)`, `console.log("%s is %d", "x", 1.5)` and `console.log("%c styled", "color:red")` must match `util.inspect`'s `formatWithOptions`. `%j`, `%o` and `%O` must give an `unsupported` stop, never guessed text. Covered in Task 7 by fixture `console-format-directives`.
4. **Values that need special printing:**
   - `-0` in arrays and in `console.log(-0)`
   - `NaN` and `Infinity` as array elements and object values
   - strings containing `'` and `"` (quote choice)
   - keys that need quoting (`{ "a-b": 1 }`)
   - circular objects (`<ref *1>` / `[Circular *1]`)
   - more than 6 numbers per line
   - more than 100 array items

   All must match `util.inspect`, through a host-`util.inspect` oracle property (Task 7) and fixtures.
5. **An uncaught error inside a nextTick, microtask, immediate or async continuation, and an error thrown while another error is printing (none in the subset).** Each needs its exact frame tail, the 10-frame cap, and an exit that skips every remaining callback. Covered in Task 6 by the frame fixtures (Task 2).

## Done-when map (PROMPT §9, Phase 3)

| Criterion | Task |
|---|---|
| 100% of fixtures match real Node byte for byte (refused fixtures per D1) | 22 |
| ≥ 1,000 generated programs with zero mismatches | 23 |
| In-subset test262 passes 100% | 23 |
| The Map, elements-kind and IC fixtures agree with V8 natives | 2, 4, 10, 22 |
| Two runs give deep-equal timelines | 19 |
| Every limit gives the "real Node would continue" notice, never a JS error | 18 |
| The nondeterministic-ordering fixture gives a fidelity warning | 17 |
| A 5,000-tick timeline stays under 20 MB | 20 |
| `/api/compile` runs the real `core/` pipeline under `next start`; a pathological program still hits the timeout | 24 |

**Review gates:** after Task 13 (sync programs run end to end) and after Task 18 (async and the loop are complete).

## File Structure

```
core/runtime/
  values/{JSValue,Smi,TheHole,tagging}.ts       primitives are host primitives; objects are HeapObject subclasses
  objects/{HeapObject,JSObject,JSArray,JSFunction,JSPromise,JSGeneratorObject,Context,ElementsKind,V8Map,TransitionTree,PropertyStorage}.ts
  ic/{FeedbackVector,InlineCache}.ts
  heap/{Heap,YoungGen,OldGen,Scavenger,MarkCompact}.ts    Illustrative; allocation counting and the heap-object limit live in Heap
  spec/{conversions,equality,operators,objectOps,callOps}.ts   ToPrimitive, ToNumber, IsLooselyEqual, OrdinaryGet, Call, …
  builtins/{console,inspect,formatWithOptions,Object,Array,Math,errors,Promise,microtask}.ts
  messages.ts                 V8 message templates for the pinned version (one table)
  stack.ts                    CallSite capture and formatting, the 10-frame cap
  Realm.ts                    intrinsics, global object, HostHooks
  MicrotaskQueue.ts
core/interpreter/{IgnitionInterpreter,Frame,Completion,dispatch/*.ts}.ts
core/host/{NodeEventLoop,VirtualClock,timers,nextTick,rejections,nodeGlobals,nodeFrames,errorPrinter,warnings,nondeterminism}.ts
core/timeline/{Tick,Command,TickRecorder,narration,TimelineStore,SimulationEngine,simulate,limits}.ts
core/bytecode/FunctionGenerator.ts          (modify: per-iteration let contexts, natives CallRuntime)
core/frontend/parse.ts, core/compile/CompilationManager.ts   (modify: natives option)
tests/conformance/{fixtures.test.ts,runner.ts,support/simulator.ts,internals.test.ts,test262.test.ts}  (modify)
tests/conformance/fixtures/*.cjs  internals/*.cjs   (new fixtures, recorded)
scripts/conformance/{fixtures,expectation,record}.mts  (modify: meta.diagnostic, meta.extract)
scripts/conformance/differential.mts        (new: npm run conformance:differential -- --runs 1000)
server/security/sandbox/compile-worker.*    server/compile/handleCompile.ts  server/validation/compile.ts
docs/{DECISIONS,FIDELITY,ARCHITECTURE,SUPPORTED_SUBSET}.md, PROMPT.md status line
```

---

## Part A: Harness extensions and new fixtures

### Task 1: Harness rules for refusals, stops and feedback extraction

**Files:**
- Modify `scripts/conformance/{fixtures,expectation,record}.mts`, `tests/conformance/{runner.ts,support/simulator.ts}`
- Test `tests/conformance/{runner,integrity,expectation}.test.ts`

**Interfaces (Produces):**
- `FixtureMetaSchema` gains `diagnostic?: DiagnosticCode`, which is required when `expect === "refused"` (a refinement), and `extract?: "feedback"`.
- `extractFeedback(stdout: string): string` (pure, in `scripts/conformance/feedback.mts`). It returns `function NAME\n` followed by `slot #N KIND STATE\n` for the kept slot kinds (D2), in print order. It drops every other line and any trailing ` {`.
- The recorder applies `extractFeedback` to stdout when `meta.extract === "feedback"`.
- `SimOutput` gains `stop?: SimulationStopSummary`, where `SimulationStopSummary = { kind: "limit" | "unsupported"; detail: string }`.
- `compareToExpectation(sim, e, meta)` behaves as follows:
  - it fails whenever `sim.stop` is set, with the message "simulation stopped (<kind>: <detail>); real node ran to completion"
  - for `meta.expect === "refused"` it applies D1

**Steps:**
- [ ] **Step 1:** Write the failing tests.
  - `extractFeedback` on the probed `%DebugPrint` excerpt (check it in as `tests/conformance/support/debugprint.sample.txt`, copied from a real run) gives `function f\nslot #0 SetNamedSloppy MONOMORPHIC\nslot #2 LoadKeyed MONOMORPHIC\nslot #5 LoadProperty UNINITIALIZED\nslot #8 LoadProperty MONOMORPHIC\n`.
  - A meta of `{expect:"refused"}` without `diagnostic` is rejected, naming the file.
  - A refused comparison passes for `{exitCode:1, stderr:"E_TS_UNSUPPORTED: TypeScript enum is not supported in strip-only mode\n"}`, and fails for exit code 0 and for another code.
  - A run with `stop` set fails even when its stdout matches.
- [ ] **Step 2:** Run `npx vitest run tests/conformance/runner tests/conformance/integrity tests/conformance/expectation`. Expect FAIL.
- [ ] **Step 3:** Implement. Add `"diagnostic": "E_TS_UNSUPPORTED"` to the three `ts-*-refused.meta.json` files.
- [ ] **Step 4:** Rerun and expect PASS. Run `npm run conformance:record` and confirm `git status` shows **no** `*.expected.json` diff, because extraction applies only to fixtures that ask for it.
- [ ] **Step 5:** Commit: `test(conformance): refusal rule, simulation stops and feedback extraction`.

### Task 2: New fixtures for frames, rejections, ICs, Maps and timer nondeterminism

**Files:**
- Create the fixtures below under `tests/conformance/fixtures/` and `internals/`.
- Run `npm run conformance:record`.
- Run `npm run conformance:status`. New fixtures enter the bytecode ratchet as `pending` or with explained exceptions (ADR-023).

**Fixtures (print everything observable):**
- **Frames.** Each throws uncaught in exactly one context:
  - `uncaught-in-nexttick`
  - `uncaught-in-microtask`
  - `uncaught-in-immediate`
  - `uncaught-in-interval-named`
  - `uncaught-after-await`
  - `uncaught-in-method`
  - `uncaught-deep-recursion-frames` (20 frames, cut to 10)
  - `error-stack-property` (prints `e.stack` caught at three depths)
- **Rejections and throws.**
  - `unhandled-rejection-non-error` (`Promise.reject(42)`)
  - `unhandled-rejection-in-async` (an async function throws, nobody awaits)
  - `throw-in-finally-overrides`
  - `builtin-callback-throws` (a throw inside a `map` callback, caught outside and printed with its stack)
- **Format.** `console-format-directives` covers `%s %d %i %f %c %%`, a lone `%`, extra arguments and too few arguments. It contains no `%j`, `%o` or `%O`.
- **Inspect edges.** `inspect-special-numbers-and-quotes` and `inspect-circular-and-long-arrays`.
- **Timers.**
  - `timer-in-timer-ordering`: timers scheduled inside timer callbacks with delays that tie existing timers. Mark it `nondeterministic: true, runs: 50` **only if** the 50 runs really differ. The meta records what was observed.
  - `immediate-vs-timeout-in-io-free-callback`: `setImmediate` vs `setTimeout(0)` scheduled from inside a timer callback, where the order is deterministic (check is before the next timers phase).
- **Internals** (`nodeArgs: ["--allow-natives-syntax"]`, plus `"--no-lazy-feedback-allocation"` for IC):
  - `ic-states`: uninitialized, monomorphic, polymorphic (2–4 shapes) and megamorphic (5 shapes) named loads; a keyed load; a named store. It uses only `%DebugPrint` and **no `console.log`**, because the two streams interleave unpredictably. Meta: `extract: "feedback"`.
  - `maps-field-generalization`: Smi → Double → Tagged on one field, read with `%HaveSameMap` and `%HasFastProperties` against a sibling object.
  - Use a `while` loop instead of `for…of`; everything must stay inside the subset.

**Steps:**
- [ ] **Step 1:** Write the fixtures. Before recording, run each one 5 times with plain `node` and confirm it is stable, unless it is the declared nondeterministic one.
- [ ] **Step 2:** Run `npm run conformance:record`, then run it again. Expect exit 0 the first time and an empty `git status` diff the second time. Run `npm run conformance:status`.
- [ ] **Step 3:** Run `npx vitest run tests/conformance`. Expect PASS: integrity, the ratchet and the todos list now names the new fixtures.
- [ ] **Step 4:** Add the probed frame tails and warning texts to the "Verified facts" of this plan, if a fixture showed a new one.
- [ ] **Step 5:** Commit: `test(conformance): record fixtures for frames, rejections, ICs, maps and nested timers`.

## Part B: The runtime model (V8's side)

### Task 3: Values, tagging and the heap's allocation count

**Files:**
- Create `core/runtime/values/*`, `core/runtime/objects/HeapObject.ts` and `core/runtime/heap/Heap.ts`
- Modify `core/shared/ids.ts`
- Test alongside each file

**Interfaces (Produces):**
```ts
type JSValue = undefined | null | boolean | number | string | HeapObject;   // primitives are host primitives (bit-exact ops only)
const TheHole: unique symbol-like singleton; type RegisterValue = JSValue | typeof TheHole
type ObjectId = Brand<number,"ObjectId">; type MapId = Brand<number,"MapId">; type TaskId = Brand<number,"TaskId">
isSmi(n: number): boolean           // 31-bit (pointer compression), integer, not -0
taggedSmi(n: number): string         // "0x…" of (n << 1) as uint32, e.g. taggedSmi(1) === "0x00000002", taggedSmi(-1) === "0xfffffffe"
abstract class HeapObject { readonly id: ObjectId }
class Heap { allocate<T extends HeapObject>(make: (id: ObjectId) => T): T; readonly allocatedCount: number }
```

- **The heap-object limit counts JS-visible allocations of the program:** objects, arrays, closures, promises, errors and generator objects. Contexts, strings, HeapNumbers and the realm's own intrinsics do not count.
- **The count is cumulative, not live.** It must be independent of the Illustrative GC model (Decision D3: a GC can never change whether a limit hits).
- `Heap.allocate` raises `SimulationHalt({ kind: "limit", limit: "heapObjects" })` when allocation 1,025 is attempted.

**Steps:**
- [ ] **Step 1:** Write the failing tests:
  - `isSmi` is false for `2**30` and `-0`, and true for `-(2**30)` and `2**30-1`
  - the tagging values above
  - ids are sequential from 1
  - the 1,025th allocation halts with the `heapObjects` limit
- [ ] **Step 2:** Run `npx vitest run core/runtime` and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Rerun and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): values, smi tagging and the heap allocation count`.

### Task 4: Maps, transitions, property storage and elements kinds

**Files:**
- Create `core/runtime/objects/{V8Map,TransitionTree,PropertyStorage,ElementsKind,JSObject,JSArray}.ts`
- Test `core/runtime/objects/*.test.ts`

**Interfaces (Produces):**
```ts
type ElementsKind = "PACKED_SMI_ELEMENTS"|"HOLEY_SMI_ELEMENTS"|"PACKED_DOUBLE_ELEMENTS"|"HOLEY_DOUBLE_ELEMENTS"|"PACKED_ELEMENTS"|"HOLEY_ELEMENTS"|"DICTIONARY_ELEMENTS"
generalizeElementsKind(from: ElementsKind, value: JSValue | "hole"): ElementsKind   // one-way lattice
type Representation = "Smi" | "Double" | "HeapObject" | "Tagged"
class V8Map { id: MapId; instanceType: "JS_OBJECT_TYPE"|"JS_ARRAY_TYPE"|"JS_FUNCTION_TYPE"|…; descriptors: readonly {key: string; representation: Representation; location: "in-object"|"backing-store"}[];
              inObjectCapacity: number; isDictionary: boolean; back?: MapId; elementsKind: ElementsKind }
class TransitionTree { rootFor(kind: "empty-object-literal"|"object-literal"|"array"|"function"|…, inObjectCapacity: number): V8Map;
                       addProperty(map: V8Map, key: string, value: JSValue): V8Map; normalize(map: V8Map): V8Map /* dictionary */ }
class JSObject extends HeapObject { map: V8Map; /* named props via PropertyStorage, elements separate */ }
```

- **Spec operations on objects**, in `core/runtime/spec/objectOps.ts`: `OrdinaryGetOwnProperty`, `OrdinaryDefineOwnProperty`, `OrdinaryGet`, `OrdinarySet`, `OrdinaryDelete` and `OrdinaryOwnPropertyKeys`.
  - `OrdinaryOwnPropertyKeys` returns integer-index keys ascending, then string keys in insertion order.
  - Array index keys live in elements, as in V8. Named keys live in the Map's descriptors or, in dictionary mode, in a dictionary that keeps insertion order.
- **Map identity rules, taken from the fixtures and nothing else:**
  - A literal `{x, y}` and `{}`+`x`+`y` get different Maps.
  - The same transitions give the same Map.
  - Generalizing a value's representation keeps the Map (D5).
  - `delete` normalizes to dictionary mode, as the recorded fixture shows.
  - Arrays share one initial Map per elements kind.

**Steps:**
- [ ] **Step 1:** Write the failing tests:
  - lattice tests: `PACKED_SMI` + `1.5` → `PACKED_DOUBLE`, + `"x"` → `PACKED_ELEMENTS`, never back; hole → `HOLEY_*`; `-0`, `NaN` and `2**31` are doubles
  - a direct-API replay of `maps-same-shape-vs-order.cjs` (build the same objects through `JSObject` operations) gives the recorded booleans
  - the same replay for `elements-kinds-transitions`
  - `OrdinaryOwnPropertyKeys({b:1, 2:0, a:1, 1:0})` gives `["1","2","b","a"]`
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): hidden-class maps, transitions and elements kinds`.

### Task 5: Spec abstract operations (conversions, equality, operators)

**Files:**
- Create `core/runtime/spec/{conversions,equality,operators}.ts`
- Test with a `.test.ts` per file, plus `core/runtime/spec/oracle.property.test.ts`

**Interfaces (Produces):**
- `ToPrimitive(realm, v, hint)`, `ToNumber`, `ToNumeric`, `ToString`, `ToBoolean`, `ToPropertyKey`, `ToInt32`, `ToUint32`. Each returns `Completion<T>`, because `ToPrimitive` can call user `valueOf`/`toString` methods.
- `IsLooselyEqual`, `IsStrictlyEqual`, `SameValue`, `SameValueZero`, `IsLessThan` (with its `LeftFirst` flag), `typeofOperator(v): string`.
- Binary operators by Ignition name: `Add`, `Sub`, `Mul`, `Div`, `Mod`, `Exp`, `BitwiseAnd`, `BitwiseOr`, `BitwiseXor`, `ShiftLeft`, `ShiftRight`, `ShiftRightLogical`.
- `Number::toString` is the host's `String(n)`. Section 3.3 lists it as bit-exact.
- `Exp` has a caveat: `**` uses the host `Math.pow` underneath. Section 3.3 excludes `Math.pow` as approximated, so `Exp` must be proven bit-exact. The oracle property below covers it over random doubles and integer exponents. If the host and real Node ever differ, `**` becomes a refused construct (an ADR), never an approximation.

**Steps:**
- [ ] **Step 1:** Write the failing tests:
  - unit cases from `loose-equality-coercions.cjs` and `number-to-string.cjs`
  - an **oracle property** over fast-check-generated primitive pairs (numbers including `-0`, `NaN` and `±Infinity`; numeric strings; `null`; `undefined`; booleans): our `IsLooselyEqual(a,b)` equals the host `a == b`, our `Add(a,b)` equals `a + b` (compared with `Object.is` for numbers), and the same for every operator and relational comparison

  The oracle compares generated *data* with host operators. No program text is evaluated.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS, 1,000 runs per property.
- [ ] **Step 5:** Commit: `feat(core): spec conversions, equality and operators`.

### Task 6: Message templates, errors, stack traces and Node's error printer

**Files:**
- Create `core/runtime/{messages,stack}.ts`, `core/runtime/builtins/errors.ts` and `core/host/{nodeFrames,errorPrinter,warnings}.ts`
- Test with `.test.ts` per file

**Interfaces (Produces):**
- `MessageTemplate`. This is a closed union, one table with fixture coverage per entry:
  - `kNotDefined` → `"%0 is not defined"`
  - `kNonObjectPropertyLoadWithProperty` → `"Cannot read properties of %0 (reading '%1')"`
  - `kAccessedUninitializedVariable` → `"Cannot access '%0' before initialization"`
  - `kConstAssign` → `"Assignment to constant variable."`
  - `kNotFunction`, `kCalledNonCallable`, `kNonObjectPropertyStoreWithProperty`, `kAllPromisesRejected`, and the rest the fixtures need
- `formatMessage(t, ...args): string`.
- `type CallSite = { functionName: string | null; typeName: string | null; methodName: string | null; isTopLevel: boolean; isAsync: boolean; pos: SourcePosition } | { native: string }`.
- `captureStack(interp): CallSite[]` captures at Error construction. It walks the frames, then appends the host's internal tail for the current entry point. It caps at 10 frames.
- `formatCallSite(cs): string` implements V8's rules: `Type.name [as method]`, `Object.<anonymous>`, bare `main.cjs:L:C` for an anonymous function with no receiver type, and the `async` prefix where a fixture shows it.
- `type EntryPoint = "main" | "nextTick" | "microtask" | "timer" | "immediate"`.
- `NODE_FRAME_TAILS: Record<EntryPoint, readonly string[]>` holds the probed constants.
- `printUncaught(error: JSValue, ctx): string` writes the code frame (source line plus a caret at the throw position), then `Name: message` plus the stack (for an Error) or the inspected value plus the trace-uncaught hint (for a non-Error), then `\n\nNode.js v24.19.0\n`.
- `printUnhandledRejection(reason, ctx): string` handles both the Error path and the `ERR_UNHANDLED_REJECTION` path.
- `ProcessWarnings` prints `(node:PID) …` and adds the `--trace-warnings` hint only once per process.

**Steps:**
- [ ] **Step 1:** Write the failing tests, as unit tests over hand-built call-site lists and error values whose expected strings are **copied from the recorded fixtures**. Read them from the `*.expected.json` in the test; never retype them. Cover:
  - `uncaught-type-error`
  - `let-tdz-uncaught`
  - `error-in-timer-uncaught`
  - `throw-non-error`
  - `unhandled-rejection`
  - `unhandled-rejection-non-error`
  - every Task 2 frame fixture
  - `timer-overflow-warning`
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code. Templates must cite `src/common/message-template.h` (V8 13.6).
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): v8 message templates, stack traces and node's error printer`.

### Task 7: `util.inspect` and console formatting

**Files:**
- Create `core/runtime/builtins/{inspect,formatWithOptions,console}.ts`
- Test `inspect.test.ts` and `tests/conformance/inspect-oracle.test.ts` (the oracle runs host `node:util`, so it lives in `tests/`)

**Interfaces (Produces):**
- `inspect(realm, v, opts?: { depth: number }): string`, with non-TTY defaults: `depth` 2, `breakLength` 80, `compact` 3, no colors. It covers:
  - numbers (`-0`), strings and quote choice, `undefined`/`null`/booleans
  - arrays: holes as `<n empty items>`, grouping of more than 6 numbers, `... n more items` past 100
  - plain objects: key quoting, `[Object]`/`[Array]` past the depth
  - functions: `[Function: f]`, `[Function (anonymous)]`, `[AsyncFunction: f]`
  - errors: the stack, plus extra own properties as `{ [errors]: […] }`
  - promises: `Promise { 1 }`, `Promise { <pending> }`, `Promise { <rejected> … }`
  - circular references: `<ref *1>`, `[Circular *1]`
- `formatWithOptions(realm, args): string | SimulationHalt` handles `%s %d %i %f %c %%`. `%j`, `%o` and `%O` give an `unsupported` stop (D3).
- `console.log`/`console.error`/`console.warn` write to the host streams through `HostHooks.write(stream, text)`.

**Steps:**
- [ ] **Step 1:** Write the failing tests:
  - unit cases from `inspect-nesting-and-wrapping`, `array-holes-inspect`, `inspect-special-numbers-and-quotes`, `inspect-circular-and-long-arrays` and `console-format-directives` (expected text read from the expectations)
  - an **oracle property**: fast-check builds random *data* values (nested arrays and objects of primitives, holes, cycles), converts each to both a host value and our model value, and requires `inspect(model) === util.inspect(host)`. It is pinned-gated and runs 2,000 runs.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code, citing `lib/internal/util/inspect.js` (Node 24.19.0) for each rule.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): util.inspect and console formatting`.

## Part C: The interpreter

### Task 8: Frames, dispatch and straight-line bytecode

**Files:**
- Create `core/interpreter/{IgnitionInterpreter,Frame,Completion}.ts`, `core/interpreter/dispatch/{loads,arith,compare,jumps}.ts` and `core/runtime/Realm.ts`
- Test `core/interpreter/*.test.ts`

**Interfaces (Produces):**
```ts
type Completion<T = JSValue> = { type: "normal"; value: T } | { type: "throw"; value: JSValue };
class Frame { fn: JSFunction; registers: RegisterValue[]; accumulator: RegisterValue; context: Context; offset: number; receiver: JSValue; args: JSValue[] }
interface HostHooks { write(stream: "stdout"|"stderr", text: string): void; promiseRejectionTracker(p: JSPromise, op: "reject"|"handle"): void;
                      entryPoint(): EntryPoint; enqueueMicrotaskObserved?(job: Job): void }
class Realm { heap: Heap; maps: TransitionTree; intrinsics: Intrinsics; globalObject: JSObject; microtasks: MicrotaskQueue; host: HostHooks }
interface StepObserver { onCommand(c: Command): void }   // implemented by TickRecorder (Task 19); a no-op in unit tests
class IgnitionInterpreter {
  constructor(program: BytecodeProgram, realm: Realm, observer: StepObserver)
  runScript(): Completion          // calls function 0 (the CJS wrapper) with (exports, require, module, __filename, __dirname); this === module.exports
  call(fn: JSFunction, receiver: JSValue, args: readonly JSValue[]): Completion   // re-entrant: builtins call back through it
}
```

- **Dispatch is one exhaustive `switch (instr.opcode)`.**
  - An opcode the generator never emits throws `UnreachableOpcode`, a programmer error, with a unit test that lists them.
  - Short-star opcodes (`Star0`…`Star15`) and `Wide`/`ExtraWide` scaling are decoded from the `Instruction`.
- **This task covers:**
  - `Lda*`/`Star`/`Ldar`/`Mov`
  - arithmetic, bitwise and `*Smi` forms (through Task 5)
  - `Test*`, `TypeOf`, `LogicalNot`, `ToBooleanLogicalNot`, `ToNumber`, `ToNumeric`, `ToString`, `Inc`/`Dec`/`Negate`/`BitwiseNot`
  - every `Jump*`, including `JumpLoop`
  - `LdaGlobal`/`LdaGlobalInsideTypeof`/`StaGlobal`, with `kNotDefined` and the sloppy vs strict `StaGlobal` rules
  - `Return`
- **Each dispatch calls `observer.onCommand({ kind: "dispatch", pos: { functionId, bytecodeOffset }, opcode })`** before it executes.

**Steps:**
- [ ] **Step 1:** Write the failing tests. Compile small programs with `CompilationManager` and run them through `IgnitionInterpreter` with a capturing host:
  - `console.log(1 + 2 * 3)` (needs a minimal `console.log`, from Task 7)
  - the outputs of `bc-locals-operators`, `bc-if-else`, `bc-loops` and `bc-logical-globals` equal their recorded stdout
  - every dispatch reported a `(functionId, bytecodeOffset)` that `sourceRangeForPos` resolves, or `undefined` only where ADR-024 allows it
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): ignition interpreter frames and straight-line dispatch`.

### Task 9: Calls, closures, contexts and TDZ

**Files:**
- Create `core/interpreter/dispatch/{calls,contexts}.ts` and `core/runtime/objects/{JSFunction,Context}.ts`
- Test `calls.test.ts`

**Covers:**
- `CreateClosure` (shares the feedback cell per creation site, as V8 does)
- `CreateFunctionContext`, `CreateBlockContext`, `CreateCatchContext`, `PushContext`/`PopContext`, `Lda/Sta[Current]ContextSlot`, `LdaImmutable*`
- `ThrowReferenceErrorIfHole` (`kAccessedUninitializedVariable`) and `CallRuntime [ThrowConstAssignError]`
- `CallUndefinedReceiver*` (sloppy `this` → the global object, strict → `undefined`), `CallProperty*`, `Construct` (only `Promise`, `Error` and its kinds, user functions as constructors are refused by the validator as they are today)
- default parameters
- the call-depth limit: the 65th user JS frame halts with `limit: "callDepth"`. **Never a RangeError.**

**Steps:**
- [ ] **Step 1:** Write the failing tests: stdout of `closure-counter`, `recursion-factorial`, `default-params`, `bc-closures`, `bc-tdz*`, `const-assign-error`, `top-level-this-and-params` and `strict-mode-this` equals the recorded stdout; depth 65 halts with the callDepth stop.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): calls, closures, contexts and tdz in the interpreter`.

### Task 10: Properties, literals and inline caches

**Files:**
- Create `core/interpreter/dispatch/properties.ts` and `core/runtime/ic/{FeedbackVector,InlineCache}.ts`
- Test `properties.test.ts` and `ic.test.ts`

**Interfaces (Produces):**
- `type IcState = "UNINITIALIZED" | "MONOMORPHIC" | "POLYMORPHIC" | "MEGAMORPHIC"`.
- `FeedbackVector` is allocated eagerly per feedback cell, following the slot layout of `FeedbackVectorSpec`.
- `InlineCache.update(slot, map)` moves UNINITIALIZED → MONOMORPHIC → POLYMORPHIC (at most 4 maps, `src/flags/flag-definitions.h max_valid_polymorphic_map_count`) → MEGAMORPHIC, and never moves back.
- `slotKindName(kind): "LoadProperty"|"LoadKeyed"|"SetNamedSloppy"|…` matches `%DebugPrint` exactly.

**Covers:**
- `GetNamedProperty`/`GetKeyedProperty`/`SetNamedProperty`/`SetKeyedProperty`/`DefineNamedOwnProperty`
- `CreateObjectLiteral` (boilerplate Map by literal shape) and `CreateEmptyObjectLiteral`
- `CreateArrayLiteral`/`CreateEmptyArrayLiteral`/`StaInArrayLiteral` (elements kind from the literal)
- `DeletePropertySloppy`/`DeletePropertyStrict`
- the `kNonObjectPropertyLoadWithProperty` and store errors
- `?.` (`JumpIfUndefinedOrNull`)
- template literals through `ToString`

**Steps:**
- [ ] **Step 1:** Write the failing tests: stdout of `bc-properties`, `bc-object-literals`, `bc-array-literals`, `object-key-order`, `object-delete-and-methods`, `bc-optional`, `logical-nullish-optional` and `strings-and-templates`; IC unit tests for the four states; a property-key-order property against host objects (data only).
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): property access, literals and inline-cache feedback`.

### Task 11: Exceptions, handler tables and finally

**Files:**
- Create `core/interpreter/dispatch/exceptions.ts`
- Test `exceptions.test.ts`

**Covers:**
- `Throw`/`ReThrow`
- unwinding through `handlerTable` (innermost range containing the offset; restores the context register as V8 does)
- `SetPendingMessage`
- `SwitchOnSmiNoFeedback` for the finally dispatch, and catch contexts
- unwinding through re-entrant builtin frames (the Review Focus 1 case)

An uncaught `Completion` reaches `runScript`'s caller unchanged. Printing is the host's job (Task 17).

**Steps:**
- [ ] **Step 1:** Write the failing tests: stdout of `bc-try-catch`, `bc-try-finally`, `try-catch-finally-order`, `throw-in-finally-overrides` and `builtin-callback-throws` (needs Task 14's `map`; until then, a unit test with a stub builtin that calls back).
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): exceptions, handler tables and finally in the interpreter`.

### Task 12: Per-iteration `let` bindings in the bytecode generator

**Files:**
- Modify `core/bytecode/FunctionGenerator.ts`
- Test `core/bytecode/functions.test.ts` and the ratchet

**Interfaces:**
- Implement V8's lowering of `for (let …)` with a captured loop variable: a fresh block context per iteration, the copy of the binding, and the first-iteration flag and temporary that `bc-loop-let`'s recorded listing shows.
- Use `npm run conformance:diff -- tests/conformance/fixtures/bc-loop-let.cjs` as the reference while working.

**Steps:**
- [ ] **Step 1:** Write the failing tests: `compile()` of `closure-in-loop-let` and `bc-loop-let` yields a program; the interpreter's stdout of `closure-in-loop-let` equals the recording; the opcodes for `perIteration` equal V8's.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code. Then run `npm run conformance:status`. The two fixtures should leave `pending`. If one cannot reach `opcodes`, it stays `pending` with the gap in FIDELITY.md, **but it must still run correctly**.
- [ ] **Step 4:** Run `npx vitest run core/bytecode tests/conformance` and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): per-iteration let contexts in bytecode`.

### Task 13: Synchronous end-to-end slice and the first review gate

**Files:**
- Create `core/timeline/simulate.ts` (the minimal version)
- Modify `tests/conformance/support/simulator.ts`
- Test `tests/conformance/fixtures.test.ts`

**Interfaces (Produces):**
- `simulate(source: string, lang: Language, opts?: SimulationOptions): SimulationResult`, where `SimulationResult = { diagnostics: Diagnostic[]; stdout: string; stderr: string; exitCode: number; warnings: string[]; stop?: SimulationStop; timeline?: TimelineStore }`.
- A program with diagnostics gives `stderr = diagnostics.map(d => `${d.code}: ${d.message}\n`).join("")` and `exitCode: 1`.
- `fixtures.test.ts` gets a `SYNC_FIXTURES` list. These are compared for real now; the rest stay `it.todo`. `SIMULATOR` stays `undefined` until Task 22, so the guard keeps working.

**Steps:**
- [ ] **Step 1:** Move every fixture that schedules nothing (no promises, timers, ticks or async) into real comparisons: `compareToExpectation(simulatorRun(fixture), expectation, meta)`.
- [ ] **Step 2:** Run `npx vitest run tests/conformance/fixtures`. Expect FAIL wherever a gap remains. Fix each one through `superpowers:systematic-debugging`.
- [ ] **Step 3:** Run the full verification: `npm run lint`, `npm run typecheck`, `npm test` and `npm run conformance`. All must pass.
- [ ] **Step 4:** Commit: `feat(core): synchronous programs match real node end to end`.
- [ ] **Step 5:** **Review gate.** Run `superpowers:requesting-code-review` on the Part B and C diff before starting async work.

## Part D: Builtins, promises and async functions

### Task 14: Object, Array, Math and Error builtins

**Files:**
- Create `core/runtime/builtins/{Object,Array,Math}.ts` and extend `errors.ts`
- Test with `.test.ts` per file

**Covers:**
- `Object.keys`
- `Array.prototype.{push,pop,map,filter,forEach,reduce}` and `length` (set and truncate), following the spec steps, with `HasProperty` skipping holes and `ArraySpeciesCreate` for plain arrays only
- `Math.{abs,ceil,floor,max,min,round,sign,sqrt,trunc}` (`max`/`min` follow the spec's `-0`/`NaN` rules)
- `Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError` and `AggregateError` (`errors` own property), with `name`/`message`/`stack` as V8 installs them (`stack` is an own accessor-like data property, captured at construction)

Every element a builtin visits charges one unit of the `work` budget (D3).

**Steps:**
- [ ] **Step 1:** Write the failing tests: stdout of `array-methods`, `array-length-truncate`, `array-holes-inspect`, `bc-method-calls`, `builtin-callback-throws` and `error-stack-property`; an oracle property for the `Math` functions over random doubles (host bit-exact comparison); the work budget halts `a.length = 4294967295; a.forEach(f)`.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): object, array, math and error builtins`.

### Task 15: Promises, jobs and the microtask queue

**Files:**
- Create `core/runtime/objects/JSPromise.ts`, `core/runtime/builtins/{Promise,microtask}.ts` and `core/runtime/MicrotaskQueue.ts`
- Test `promise.test.ts`

**Interfaces (Produces):**
- Spec operations by name:
  - `NewPromiseCapability`, `CreateResolvingFunctions`, `FulfillPromise`, `RejectPromise`, `TriggerPromiseReactions`
  - `PerformPromiseThen`, `NewPromiseReactionJob`, `NewPromiseResolveThenableJob`, `PromiseResolve`
  - `HostPromiseRejectionTracker` (→ `realm.host.promiseRejectionTracker`)
- `Promise` (the constructor, with the executor called synchronously), `resolve`/`reject`/`all`/`race`/`allSettled`/`any`, and `prototype.then`/`catch`/`finally` with V8's `thenFinally`/`catchFinally`/value-thunk functions.
- `queueMicrotask`.
- `type Job = { id: TaskId; kind: "PromiseReactionJob" | "PromiseResolveThenableJob" | "CallbackJob"; run(): Completion; label: string }`.
- `MicrotaskQueue.enqueue(job)` and `MicrotaskQueue.drain(observer)`. `drain` runs to empty and reports `job-start`/`job-end` commands.
- `Promise.resolve(p)` returns `p` itself when `p` is a native promise whose `constructor` is `%Promise%`.

**Steps:**
- [ ] **Step 1:** Write the failing tests. The host for this task is a minimal one: drain the microtasks after the script, with no Node loop. Check:
  - stdout of `promise-resolve-same-promise`, `finally-passthrough`, `promise-combinators` (no timers) and `queuemicrotask-order` (no nextTick parts)
  - a unit test counting jobs: resolving with a thenable costs exactly 2 extra jobs (`NewPromiseResolveThenableJob`, then `then`)
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): promises, reaction jobs and the microtask queue`.

### Task 16: Async functions and `await`

**Files:**
- Create `core/runtime/objects/JSGeneratorObject.ts` and `core/interpreter/dispatch/generators.ts`
- Test `async.test.ts`

**Covers:**
- `SwitchOnGeneratorState`, `SuspendGenerator` (saves the registers and the offset into the generator object), `ResumeGenerator`
- `InvokeIntrinsic [_AsyncFunctionEnter|_AsyncFunctionAwait|_AsyncFunctionResolve|_AsyncFunctionReject|_GeneratorGetResumeMode]`
- `Await` per spec: `PromiseResolve(%Promise%, v)`, then `PerformPromiseThen` with the resume closures. A native promise takes 1 tick.
- `return await` vs `return`
- a rejection inside an async function routed through the handler table with `prediction=3`

**Steps:**
- [ ] **Step 1:** Write the failing tests: stdout of `async-await-order`, `return-vs-return-await`, `bc-async`, `await-thenable-two-extra-ticks` and `uncaught-after-await` (frames come in Task 17); a unit test where an async function suspended at `await` and resumed twice keeps its registers.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): async functions and await on the generator machinery`.

## Part E: Node's side

### Task 17: The Node event loop, timers, ticks, rejections and nondeterminism

**Files:**
- Create `core/host/{NodeEventLoop,VirtualClock,timers,nextTick,rejections,nodeGlobals,nondeterminism}.ts`
- Test `core/host/*.test.ts`

**Interfaces (Produces):**
```ts
class VirtualClock { now(): number; advanceTo(ms: number): void }          // JS execution costs 0 virtual ms
class NodeEventLoop implements HostHooks {
  constructor(realm: Realm, interp: IgnitionInterpreter, observer: StepObserver)
  run(): { exitCode: number }   // main script → processTicksAndRejections → loop phases until nothing is ref'd
}
type LoopPhase = "timers" | "pending" | "poll" | "check" | "close"
```

**Rules (cite `lib/internal/process/task_queues.js` and `lib/internal/timers.js` at v24.19.0):**
- **`processTicksAndRejections`:**
  - Drain the whole nextTick queue, running each tick and then `runMicrotasks()` (the V8 queue, fully drained).
  - Repeat while ticks remain, then process rejections.
  - Run it after the main script and after **each** timer and immediate callback.
- **Timers.**
  - Delay coercion: `< 1`, non-numeric or `> 2**31-1` all become 1. The overflow writes a `TimeoutOverflowWarning` through `ProcessWarnings`.
  - Lists are keyed by duration and ordered by expiry, then creation.
  - The timer start time is the cached loop time (`getLibuvNow`), which is constant during the main script.
  - Intervals re-arm from the callback's start time.
  - `clearTimeout`/`clearInterval`/`clearImmediate`, ref'd handles, and exit when nothing is ref'd.
- **Immediates** run in the check phase, in insertion order. Immediates queued during the check phase wait for the next iteration.
- **Unhandled rejections** use the default `throw` mode. After the drain, every promise still unhandled, in rejection order, goes through `printUnhandledRejection`, which ends with exit code 1. A promise handled before the check (`rejection-handled-late`) prints nothing.
- **Uncaught exceptions.** One in any callback prints through `printUncaught` with the `EntryPoint` frame tail, then the process exits with code 1. Nothing else runs.
- **Nondeterminism**, in `nondeterminism.ts`, is one rule per probed case.
  - Rule 1: a `setTimeout(≤1)` and a `setImmediate` both pending at the first loop iteration after the main script. The rule emits the warning `Order not guaranteed in real Node: whether the 1 ms timer is due before the first loop iteration depends on how long startup took.`
  - Each rule names the fixture that proves it. Add a rule for `timer-in-timer-ordering` only if Task 2 recorded it as nondeterministic.
  - The simulator always picks the order of `outcomes[0]` and never a random one.
- **Ownership.** Node's globals (`process.nextTick`, `setTimeout` and the rest, `setImmediate`, `console`'s streams) are installed by `nodeGlobals.ts`, not by `core/runtime`. This is the V8/Node boundary §3.1 asks us to teach.

**Steps:**
- [ ] **Step 1:** Write the failing tests: stdout, stderr and exit code of every async and loop fixture through `simulate`:
  - `promise-vs-timeout`, `nexttick-vs-promise`, `queuemicrotask-order`, `drain-after-each-callback`
  - `timers-same-expiry-order`, `timer-delay-coercion`, `timer-overflow-warning`, `interval-clear`
  - `unhandled-rejection*`, `rejection-handled-late`, `error-in-timer-uncaught`, `uncaught-in-*`
  - `timeout-vs-immediate-main` (equals `outcomes[0]` **and** warns /not guaranteed/)
  - `immediate-vs-timeout-in-io-free-callback` (no warning)
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): node event loop, timers, nextTick and rejection processing`.

### Task 18: Limits and stops

**Files:**
- Create `core/timeline/limits.ts`
- Modify the engine entry points
- Test `limits.test.ts`

**Interfaces (Produces):**
- `LIMITS = { ticks: 5000, callDepth: 64, heapObjects: 1024, virtualTimeMs: 60000, work: 1_000_000 } as const`.
- `class SimulationHalt extends Error { readonly stop: SimulationStop }`.
- `SIMULATION_LIMIT_NOTICE = "Simulation limit reached — real Node would continue"`.

**Steps:**
- [ ] **Step 1:** Write the failing tests, one program per limit:

  | Limit | Program |
  |---|---|
  | `ticks` | `while (true) {}` |
  | `callDepth` | `function f(){ f(); } f();` |
  | `heapObjects` | `while (true) { [] }` written as a bounded subset loop |
  | `virtualTime` | `setInterval(() => console.log("x"), 1000)` |
  | `work` | the holey-array `map` from Review Focus 2 |

  Each result has:
  - `stop.kind === "limit"` naming that limit
  - `warnings` containing the notice
  - stdout equal to the output up to the stop (the interval prints exactly 60 lines, timers due at or before 60,000 ms)
  - stderr containing neither `RangeError` nor `Maximum call stack`
  - `exitCode` is `0`, because the process never exited; `stop` is what says the run is incomplete (document this on the type)

  Also test that `%j` gives an `unsupported` stop.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code. `SimulationEngine` (and, until Task 19, `simulate`) is the only catcher of `SimulationHalt`.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): simulation limits with the "real node would continue" notice`.
- [ ] **Step 6:** **Review gate.** Run `superpowers:requesting-code-review` on Parts D and E.

## Part F: Timeline

### Task 19: Ticks, commands, narration and the SimulationEngine

**Files:**
- Create `core/timeline/{Tick,Command,TickRecorder,narration,SimulationEngine}.ts`
- Modify `simulate.ts`
- Test `*.test.ts` and `tests/conformance/tick-budget.test.ts`

**Interfaces (Produces):**
```ts
type TickPhase = "script"|"nextTick"|"microtask"|"timers"|"check"|"loop-transition"|"gc"|"exit"
type Command =
  | { kind: "dispatch"; pos: BytecodePos; opcode: Opcode }
  | { kind: "job-start"; queue: "nextTick"|"microtask"|"timers"|"check"; task: TaskRef }
  | { kind: "job-end"; task: TaskRef }
  | { kind: "loop-phase"; phase: LoopPhase }
  | { kind: "gc"; event: GcEvent }
  | { kind: "exit"; code: number }
type Tick = DeepReadonly<{                         // §7.5 minus Phase 4/7 fields (D4)
  index: number; phase: TickPhase; pos: BytecodePos | null; currentLine: number | null;
  callStack: FrameSnapshot[];  // function name, FunctionId, bytecodeOffset, registers r0..rn and accumulator as ValueSnapshot, context id
  hostApis: HostEntry[]; nextTickQueue: TaskRef[]; microtaskQueue: TaskRef[]; timerQueue: TaskRef[]; immediateQueue: TaskRef[];
  loopPhase: LoopPhase | null; console: ConsoleLine[]; virtualTimeMs: number;
  v8: { maps: MapSnapshot[]; changedMapId?: MapId; feedback: FeedbackSnapshot[]; elementsKinds: Record<ObjectId, ElementsKind>;
        heap: { young: HeapRegion; old: HeapRegion; lastGc?: GcEvent } };
  warnings: FidelityWarning[]; narration: string }>
type ValueSnapshot = { kind: "smi"; value: number; tagged: string } | { kind: "heap-number"; value: number } | { kind: "string"; value: string }
                   | { kind: "oddball"; name: "undefined"|"null"|"true"|"false"|"the_hole" } | { kind: "object"; id: ObjectId; mapId: MapId; preview: string }
narrate(command: Command, before: Tick | null, after: TickDraft): string
class SimulationEngine { run(program: BytecodeProgram, source: string, opts: SimulationOptions): SimulationResult }   // the only catcher of SimulationHalt
```

- **`TickRecorder`** implements `StepObserver`. It reuses the previous tick's sub-objects when unchanged (structural sharing, D6).
- **Narration.** Each `Command` kind has a template in the friendly-coach voice (PRODUCT.md) that names the mechanism. It is exhaustive over `Command["kind"]`, and the important opcodes, IC transitions, Map transitions and elements-kind transitions have specific templates. Examples:
  - `PerformPromiseThen queued a PromiseReactionJob; V8 runs microtasks before Node's timers phase.`
  - `Property y added → new hidden class Map#3 (transition from Map#2).`
- **Exactness firewall.** The recorder and narration only *read* state. A unit test runs every fixture with the observer on and off, and requires identical stdout, stderr and exit code.

**Steps:**
- [ ] **Step 1:** Write the failing tests:
  - **Determinism.** `simulate()` twice on each of 10 fixtures gives `toStrictEqual` timelines.
  - **Firewall.** The observer on/off test above.
  - **Narration snapshot.** For `nexttick-vs-promise`, the job-start narrations mention `process.nextTick` (Node) before `PromiseReactionJob` (V8).
  - **Tick budget (D4 gate).** `tick-budget.test.ts` counts ticks for every program fixture and every vendored test262 test and requires ≤ 5,000. **If it fails, stop the phase and ask the human (D4); do not change the limit or the granularity yourself.**
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): ticks, narration and the simulation engine`.

### Task 20: Timeline storage and the 20 MB budget

**Files:**
- Create `core/timeline/TimelineStore.ts`
- Test `TimelineStore.test.ts`

**Interfaces (Produces):**
- `TimelineStore.fromTicks(ticks)`, `length`, `at(i): Tick` (an LRU of 256), `keyframeInterval = 64`, `serialize(): string` (bigint → hex string) and `TimelineStore.deserialize(json)`.
- A patch is `{ index, set: Partial<Tick> }` over the top-level keys whose reference changed.

**Steps:**
- [ ] **Step 1:** Write the failing tests:
  - for any `i`, `at(i)` deep-equals the original tick (a property over a 5,000-tick program, including `i` in reverse and random order)
  - `deserialize(serialize(s))` round-trips
  - **budget:** a 5,000-tick program with growing console output, 64 live objects and 3 live timers serializes to ≤ 20 × 1024 × 1024 UTF-8 bytes
  - the LRU never holds more than 256 materialized ticks
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): keyframed timeline storage within the 20 MB budget`.

### Task 21: Heap generations and GC events (Illustrative)

**Files:**
- Create `core/runtime/heap/{YoungGen,OldGen,Scavenger,MarkCompact}.ts`
- Test `heap.test.ts`

**Covers:**
- a modeled young generation (semi-spaces) and an old generation, with sizes from estimated instance sizes
- a scavenge when the young generation fills, with promotion after 2 survived scavenges, and mark-compact for the old generation
- reachability from roots: frames, contexts, queues, timers and the global object
- `gc` commands with addresses and timings marked Illustrative

**Steps:**
- [ ] **Step 1:** Write the failing tests:
  - a scavenge promotes a twice-surviving object
  - an unreachable object is reclaimed
  - **firewall property:** running any fixture with the young-generation size at 1 KB, 16 KB and 1 MB gives identical stdout, stderr and exit code
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit: `feat(core): illustrative young/old generation heap and gc events`.

## Part G: Conformance at full strength

### Task 22: Set SIMULATOR, every fixture, and the internals fixtures through natives mode

**Files:**
- Modify `tests/conformance/{support/simulator.ts,fixtures.test.ts}`, `core/frontend/parse.ts`, `core/compile/CompilationManager.ts` and `core/bytecode/FunctionGenerator.ts` (`CallRuntime [Name]` for `V8IntrinsicIdentifier` calls)
- Create `core/runtime/builtins/natives.ts` and `tests/conformance/internals.test.ts`

**Interfaces (Produces):**
- `CompileOptions = { natives?: boolean }` and `SimulationOptions = { host?: "node" | "test262"; natives?: boolean }`. Both are absent from every Zod input schema (D2, D7).
- `SIMULATOR: Simulator` adapts `simulate` to `SimOutput` (including `stop`).

**Steps:**
- [ ] **Step 1:** Set `SIMULATOR`. Replace **every** `it.todo` in `fixtures.test.ts` with `compareToExpectation(SIMULATOR.run(source, lang), expectation, meta)`, and delete `TODO_FIXTURES`. The guard test stays and passes with an empty list.
- [ ] **Step 2:** Write the failing tests in `internals.test.ts`:
  - each `internals` fixture is compiled with `{ natives: true }`, simulated, and compared byte for byte, with `extractFeedback` applied to our stdout too when `meta.extract` is set
  - **reachability tests:** `CompileInput.safeParse({ code, lang, natives: true })` fails (`.strict()`); the browser worker message schema rejects it too once Phase 5 adds it (leave a note in Phase 5's open risks); `compile("%HaveSameMap(a,b)", "js")` without the option gives `E_SYNTAX`
- [ ] **Step 3:** Run `npm run conformance`. Expect FAIL until every mismatch is fixed. Debug each with `superpowers:systematic-debugging`, and never touch an expectation.
- [ ] **Step 4:** Rerun and expect PASS with 0 todos. Paste the summary line into the task report.
- [ ] **Step 5:** Commit: `test(conformance): every fixture and internals probe matches real node`.

### Task 23: test262 through the simulator, and 1,000 differential programs

**Files:**
- Create `core/host/test262Harness.ts` and `scripts/conformance/differential.mts`
- Modify `tests/conformance/test262.test.ts`, `package.json` (script `conformance:differential`: `tsx scripts/conformance/differential.mts`) and `tests/conformance/differential.test.ts`

**Steps:**
- [ ] **Step 1:** Write the failing tests.
  - Implement the harness builtins exactly as `harnessContract.md` specifies (`assert.throws` compares the thrown object's constructor internally; user code still cannot reach `.constructor`).
  - Replace the `it.todo` with a loop: `runTest262(SIMULATOR_WITH_HOST_TEST262, test)` over every vendored test must pass. Collect the failures and print them all.
- [ ] **Step 2:** Run `npx vitest run tests/conformance/test262` and expect FAIL until every failure is fixed. Only if a test is truly outside the subset does it move to `exclusions.json`, with a closed-enum reason, through `npm run conformance:vendor-test262` (never by hand).
- [ ] **Step 3:** Add a pinned-gated `differentialProperty(SIMULATOR, { numRuns: 25 })` test to `npm test`. `differential.mts` takes `--runs N --seed S` and prints `runs`, `discarded` and the seed.
- [ ] **Step 4:** Run `npm run conformance:differential -- --runs 1000`. Expect `runs: 1000`, `0 mismatches` and `discarded` ≤ 2%. Paste the output. A mismatch commits its shrunk program as a new fixture (record it), and gets fixed.
- [ ] **Step 5:** Commit: `test(conformance): test262 subset and 1000-program differential pass on the simulator`.

## Part H: The server worker

### Task 24: `/api/compile` runs the real pipeline under `next start`

**Files:**
- Replace `server/security/sandbox/compile-worker.mjs`
- Modify `server/security/sandbox/pool.ts`, `server/compile/handleCompile.ts` and `server/validation/compile.ts`
- Test `tests/integration/compile-route.test.ts`, `server/security/sandbox/pool.test.ts` and `e2e/security.spec.ts`

**Interfaces (Produces):**
- Worker protocol: in `{ id, input: { code, lang } }`; out `{ id, value: CompileSummary }`.
- `CompileSummary` is the D8 shape, Zod `.strict()`, parsed by the parent before use.
- The worker imports `simulate` from `core/`.

**Spike, in this order; ship the first that passes the e2e under `next start`:**
1. A TypeScript worker entry `compile-worker.ts`, created as `new Worker(new URL("./compile-worker.ts", import.meta.url))` and bundled by Turbopack.
2. Prebuild the worker with `esbuild`, added as a direct devDependency. Use a `prebuild` step (`scripts/build-worker.mts`) that bundles `core/` into `server/security/sandbox/dist/compile-worker.mjs`, and include it with `outputFileTracingIncludes`. `scripts/check-build.mts` must scan that file too.

Record which path shipped in the ADR (closing ADR-010's risk).

**Steps:**
- [ ] **Step 1:** Write the failing tests:
  - **Integration (direct pool):** `{code:"console.log(1)", lang:"js"}` gives `output.stdout === "1\n"`.
  - **Integration:** a program with an excluded API gives `diagnostics[0].code === "E_EXCLUDED_API"` and no `output`.
  - **Timeout:** a pool with `timeoutMs: 1` running a program that reaches the tick limit gives `{ status: "timeout" }` and audits `sandbox.timeout`.
  - **e2e:** `POST /api/compile` on the production server returns the real summary for "nextTick vs Promise" (stdout equals the recorded fixture).
- [ ] **Step 2:** Run `npx vitest run tests/integration/compile-route server/security/sandbox` and `npm run e2e`. Expect FAIL.
- [ ] **Step 3:** Implement spike path 1. If its e2e fails, implement path 2.
- [ ] **Step 4:** Run `npm run build` (including `check-build`: no `eval`, `child_process` or `vm` in the output) and `npm run e2e`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(server): compile worker runs the real core pipeline`.

### Task 25: Documentation, ADRs and phase verification

**Files:**
- Modify `docs/{DECISIONS,FIDELITY,ARCHITECTURE,SUPPORTED_SUBSET}.md`, `PROMPT.md` (the status line), `CLAUDE.md` (the `conformance:differential` command row) and this plan's Verified facts

**Steps:**
- [ ] **Step 1:** Add the ADRs for D1 to D8 (from ADR-025), each with context, decision and consequence, including what the D4 gate measured.
- [ ] **Step 2:** Update FIDELITY.md:
  - the eager vs lazy feedback allocation gap
  - IC states for non-property slots, which are Modeled
  - heap and GC as Illustrative
  - each `unsupported` stop reason
  - the nondeterminism rules and their fixtures
  - the bytecode ratchet counts after Task 12
- [ ] **Step 3:** Update ARCHITECTURE.md with the V8/Node layering diagram (`core/runtime` + `core/interpreter` vs `core/host`) and the Command → Tick → `TimelineStore` flow.
- [ ] **Step 4:** Run the full verification and paste every output:
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`
  - `npm run conformance`
  - `npm run conformance:differential -- --runs 1000`
  - `npm run build`
  - `npm run e2e`
- [ ] **Step 5:** Run `/code-review` on the phase diff. Fix the agreed findings and note the rejected ones in the report. Commit: `docs: phase 3 ADRs, fidelity gaps and architecture`.
- [ ] **Step 6:** Report and **stop for review**. The report covers what was built, the verification output, the deviations (the ADRs), the fidelity gaps and the open risks:
  - the Phase 5 worker schema must keep natives and test262 unreachable
  - Phase 4 adds `machine` to `Tick`
  - the tick-granularity outcome
