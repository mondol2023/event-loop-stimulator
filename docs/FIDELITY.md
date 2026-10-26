# Fidelity

What Silicon Loop shows, how true each view is, and how we know. The pinned runtime is in [`TARGET.md`](TARGET.md); the contract is PROMPT.md §3.

## Truth levels

Every pane and view carries one of these as a quiet badge with a one-sentence tooltip.

| Badge | Meaning (tooltip) |
|---|---|
| **Exact** | "Exact: byte-identical to real Node on the pinned version." |
| **Verified model** | "Verified model: our reconstruction, checked against real V8 on test programs. Your program's details may differ." |
| **Modeled** | "Modeled: how V8 would typically behave; V8's heuristics change between versions." |
| **Illustrative** | "Illustrative: a teaching picture of the idea, not V8's actual output." |

## What each view guarantees

| What the learner sees | Level | How it's guaranteed |
|---|---|---|
| Console output text (incl. `util.inspect` formatting of arrays/objects/strings/numbers) | **Exact** | Spec interpreter + our `inspect` reimplementation; differential tests vs pinned Node |
| Order of sync code, nextTicks, microtasks, timers, immediates | **Exact** | Spec job semantics + Node loop model; differential tests |
| What the client worker changes | **Exact layer unchanged** | The worker runs the same `simulate` pipeline as the server-side tests (Task 3's stdout test proves it), and the timeline is serialized and revived unchanged (ADR-040). Playback speed only chooses which tick is shown (ADR-044) |
| Uncaught exception / unhandled rejection output, and the exit code | **Exact** after documented normalization (file path → `main.cjs`) | V8 message templates; differential tests |
| Variable values, object key order, number→string conversion | **Exact** | Spec operations; differential tests |
| AST and scope analysis (hoisting, TDZ, closures) | **Exact** with respect to ESTree and spec scoping | Parser + scope unit tests |
| Ignition bytecode listing | **Verified model** | Same opcode sequence as `node --print-bytecode` for every fixture function; operand differences listed below |
| Hidden classes (Maps), transitions, in-object vs backing-store properties, elements kinds | **Verified model** | Fixtures assert against V8 natives (`--allow-natives-syntax`: `%HaveSameMap`, `%HasSmiElements`, `%HasDoubleElements`, `%DebugPrint`) |
| Inline-cache states, feedback slots | **Verified model** where `%DebugPrint` exposes it; otherwise **Modeled** | Fixture checks |
| Tier-up to Sparkplug / Maglev / TurboFan and deopts | **Modeled** | Shown as "would typically…"; not checked by a fixture; Modeled |
| Smi vs HeapObject tagging, pointer compression | **Illustrative** | Not Node 24.19.0's layout. The panes use a 31-bit Smi and a compressed-pointer scheme the pinned build does not have (row below, ADR-039) |
| Smi range, registers and pointer compression of the asm and register panes | **Illustrative** | A 31-bit Smi (`rax = value << 1`, overflow at 2**30) and a cage base in `r14`. The pinned Node 24.19.0 build has pointer compression off, stores 32-bit Smis as `value << 32`, and `%IsSmi(2**30)` is true there (probed once on 24.19.0; not recorded as a fixture) (ADR-039). This supersedes the row above for the model's registers and Smi range |
| Map offsets, Context layout, `InstanceType` numbers | **Illustrative** | Chosen for the teaching panes, not read from V8 (ADR-039) |
| Heap addresses, young/old generation occupancy, GC timing | **Illustrative** | Never affects Exact results |
| Machine code (assembly) and register contents | **Illustrative** | Sparkplug-style per-bytecode templates using V8's real x64 register roles |
| Machine-code bytes | **Exact encoding of the shown assembly** | Golden bytes in tests/conformance/asm/encodings.expected.json, checked against a real LLVM assembler (llvm-mc, or clang's integrated assembler when llvm-mc is absent; recorded with clang 23.1.4 because llvm-mc was not installed; ADR-036) |
| Machine-state flags | **Illustrative** | Projected only when the shown instruction is a `cmp` (`TestNull`, `TestUndefined`, `TestReferenceEqual`); `null` at every other bytecode (ADR-033) |
| Which tier a function is in, and when it changes | **Modeled** | Invocation counts of 8 / 400 / 3000, not V8's interrupt budget and concurrent compilation; see the tiering notes below (ADR-037) |
| CPU caches, ALU, buses (3D) | **Illustrative** | — |
| Example badge "Matches Node vX (V8 Y)" | **Exact**, only for recorded fixtures | Shown only when the editor text equals an example's source byte for byte; `tests/conformance/examples.test.ts` checks the catalog and the simulator's stdout against the recording (ADR-049). A user program shows "Simulated by spec model". |
| 2D event loop view | **Exact** ordering and queue contents; animation is presentation only | Rendered from the same timeline as the console. Motion, spring values and the playback rate change how it looks, never which tick comes next (ADR-044). |

## Excluded constructs

These are refused with a diagnostic instead of approximated, so they can never produce a wrong answer. The supported side is in [`SUPPORTED_SUBSET.md`](SUPPORTED_SUBSET.md). This table is generated from `core/frontend/subset/excluded.ts` by `npm run docs:subset`.

<!-- excluded-table:begin (generated by npm run docs:subset; do not edit) -->

| Construct | Diagnostic | Why it is refused |
|---|---|---|
| `class` declarations and expressions | `E_NOT_YET_SUPPORTED` | Classes (fields, private names, accessors) need their own recorded fixtures. It can be added later, with fixtures recorded on real Node. |
| `switch` | `E_NOT_YET_SUPPORTED` | It can be added later, with fixtures recorded on real Node. |
| `do…while` | `E_NOT_YET_SUPPORTED` | It can be added later, with fixtures recorded on real Node. |
| `for…in` | `E_NOT_YET_SUPPORTED` | Enumeration order and prototype-chain walking need their own fixtures. It can be added later, with fixtures recorded on real Node. |
| `for…of` and `for await` | `E_NOT_YET_SUPPORTED` | The iteration protocol (Symbol.iterator) is outside the subset. It can be added later, with fixtures recorded on real Node. |
| labeled statements | `E_NOT_YET_SUPPORTED` | It can be added later, with fixtures recorded on real Node. |
| destructuring patterns | `E_NOT_YET_SUPPORTED` | Destructuring uses the iterator protocol for arrays. It can be added later, with fixtures recorded on real Node. |
| spread and rest (`...`) | `E_NOT_YET_SUPPORTED` | Spread uses the iterator protocol. It can be added later, with fixtures recorded on real Node. |
| `arguments` of a sloppy function with parameters | `E_NOT_YET_SUPPORTED` | A sloppy function's arguments object aliases its parameters, which is not modeled; the unmapped object of strict code, of parameter expressions and of a function with no parameters is. It can be added later, with fixtures recorded on real Node. |
| `instanceof` | `E_NOT_YET_SUPPORTED` | It depends on Symbol.hasInstance and prototype chains. It can be added later, with fixtures recorded on real Node. |
| `in` | `E_NOT_YET_SUPPORTED` | It walks the prototype chain. It can be added later, with fixtures recorded on real Node. |
| `with` | `E_NOT_YET_SUPPORTED` | `with` makes name resolution dynamic, which the scope model does not represent. |
| tagged templates | `E_NOT_YET_SUPPORTED` | Template objects are cached per call site and frozen. It can be added later, with fixtures recorded on real Node. |
| `void` | `E_NOT_YET_SUPPORTED` | It can be added later, with fixtures recorded on real Node. |
| `debugger` | `E_NOT_YET_SUPPORTED` | It has no effect without an attached debugger. |
| computed keys in object literals | `E_NOT_YET_SUPPORTED` | It can be added later, with fixtures recorded on real Node. |
| `new.target` | `E_NOT_YET_SUPPORTED` | It can be added later, with fixtures recorded on real Node. |
| generators and `yield` | `E_EXCLUDED_FEATURE` | Generators are excluded from the subset (async functions are supported). |
| `get` / `set` accessors | `E_EXCLUDED_FEATURE` | Accessor properties change the hidden-class (Map) model and are excluded. |
| regular expression literals | `E_EXCLUDED_FEATURE` | A faithful regex engine (Irregexp semantics) is out of scope. |
| `BigInt` literals (`1n`) | `E_EXCLUDED_FEATURE` | BigInt is excluded from the subset. |
| `import()`, `import`/`export`, top-level `await` | `E_EXCLUDED_FEATURE` | There is a single script; module loading is I/O. |
| `.constructor`, `.prototype`, `__proto__` | `E_EXCLUDED_FEATURE` | Prototype manipulation and `Function` access are outside the subset. |
| TypeScript `enum` | `E_TS_UNSUPPORTED` | Node's strip-only type stripping refuses it too, because an enum has a runtime representation. |
| TypeScript `namespace` with values | `E_TS_UNSUPPORTED` | Node's strip-only type stripping refuses it too. |
| TypeScript parameter properties | `E_TS_UNSUPPORTED` | Node's strip-only type stripping refuses it too. |
| TypeScript `import x = require()`, `export =`, decorators, `<T>expr` casts | `E_TS_UNSUPPORTED` | Node's strip-only type stripping refuses these too. |
| `Date` | `E_EXCLUDED_API` | Wall-clock and time-zone dependent. |
| `Symbol` | `E_EXCLUDED_API` | Symbols are excluded from the subset. |
| `BigInt` | `E_EXCLUDED_API` | BigInt is excluded from the subset. |
| `Proxy`, `Reflect` | `E_EXCLUDED_API` | Proxy traps change every object operation; they are excluded. |
| `WeakRef`, `FinalizationRegistry` | `E_EXCLUDED_API` | GC-dependent, so never Exact. |
| `performance` | `E_EXCLUDED_API` | Clock dependent. |
| `fetch` and other I/O (`fs`, `http`, `URL`, streams, `crypto`, …) | `E_EXCLUDED_API` | I/O is never run. |
| `eval`, `Function` | `E_EXCLUDED_API` | Dynamic code evaluation is never run, by design. |
| `globalThis`, `global` | `E_EXCLUDED_API` | It would bypass the scope-resolved exclusion of other globals. |
| `Math` members other than `abs ceil floor max min round sign sqrt trunc` | `E_EXCLUDED_API` | `Math.random` is nondeterministic; `sin`/`cos`/`exp`/`pow`/… are approximated and can differ between engines and versions. |
| `process` members other than `nextTick` | `E_EXCLUDED_API` | Environment, arguments, clocks and exit codes are host dependent. |
| `require`, `__filename`, `__dirname`, `module` members | `E_EXCLUDED_API` | File paths and the module loader are host dependent. |
| a namespace global used as a value (`const m = Math`) | `E_EXCLUDED_API` | Exclusions are resolved through scope analysis; an alias would bypass the member check. |
| other members of supported globals (`Object.assign`, `console.table`, `String.fromCharCode`, …) | `E_NOT_YET_SUPPORTED` | It can be added later, with fixtures recorded on real Node. |
| every other Node global (`JSON`, `Map`, `Set`, `parseInt`, `Buffer`, typed arrays, `Intl`, …) | `E_NOT_YET_SUPPORTED` | It can be added later, with fixtures recorded on real Node. |
| source larger than 10,240 bytes (UTF-8) | `E_LIMIT_SOURCE_SIZE` | A fixed limit keeps compilation and the simulation bounded. |
| more than 400 lines | `E_LIMIT_LINES` | A fixed limit keeps compilation and the simulation bounded. |

<!-- excluded-table:end -->

## Known gaps

Each gap names the construct, the difference from real Node/V8, and the fixture that shows it. The first group is the front end and the bytecode (Phase 2); the groups after it are the interpreter, the runtime model and the loop (Phase 3).

- **V8's `SyntaxError` text is not reproduced.** A program with a syntax error gets our own `E_SYNTAX` diagnostic (a range and a hint). Real Node prints V8's message, source line and caret on stderr. A test262 `negative: {phase: parse}` test is judged by the code, not the wording (ADR-024). Errors that Babel recovers from (`let x; let x;`, a misplaced `return`) become diagnostics too, so no bytecode is produced for them.
- **Node-internal stack frames are constants of the pinned version.** The stack of an uncaught error ends in frames such as `node:internal/modules/cjs/loader:1872:14`. We can print them only as recorded for Node 24.19.0; they are not derived from anything and change with the target ([`TARGET.md`](TARGET.md)). Seen in: `uncaught-type-error`, `uncaught-reference-error`, `unhandled-rejection`, `let-tdz-uncaught` and `error-in-timer-uncaught`.
- **Bytecode of a function that is never called is unverified.** V8 compiles lazily, so real Node prints no bytecode for it and there is nothing to compare with (ADR-022). The generator still compiles it.
- **One bytecode fixture is `pending`**, listed under "Bytecode operand differences" below: `loose-equality-coercions`.

### Interpreter and runtime model (Phase 3)

- **Eager vs lazy feedback allocation.** The model allocates a closure's `FeedbackVector` when the closure is created, which is what real V8 does under `--no-lazy-feedback-allocation`. Real V8's default is lazy: a function called only a couple of times has **no** feedback vector, and the vector appears after a budget of invocations. The internals fixtures are recorded with `--no-lazy-feedback-allocation` so they compare by bytes (ADR-026); a learner who runs the same program in a plain `node` would see the vector later than we show it. Seen in: `ic-states`.
- **IC states for non-property slots are Modeled.** `%DebugPrint` exposes the property-IC slots (`LoadProperty`, `LoadKeyed`, `SetNamed*`, `SetKeyed*`, `DefineNamedOwn`), and those states are Verified against it. The states of call, binary-operation, compare and `TypeOf` slots (`UNINITIALIZED → MONOMORPHIC → …` and the type-feedback lattice) follow V8's documented state machine but no fixture can read them back, so they are Modeled. Only the five-shape rule for megamorphic property loads is probed.
- **Heap and GC are Illustrative.** The young/old generation split, object addresses, sizes, scavenges and mark-compacts are a teaching picture (`core/runtime/heap`). They never affect output or a limit: the `heapObjects` limit counts cumulative allocations, independent of the GC model (ADR-027). The `gc` ticks are emitted at points our model chooses, not where V8 would collect.
- **Map rules without a fixture are Modeled.** Hidden-class transitions, in-object slack and elements-kind transitions that the internals fixtures probe (`maps-same-shape-vs-order`, `maps-field-generalization`, `elements-kinds-transitions`) are Verified. Anything beyond them, such as the dictionary-mode threshold other than `delete`, follows V8's source and is not checked (ADR-029).
- **Tick granularity is statement-level**, not one tick per bytecode (ADR-028). `recursion-factorial` takes 4,880 of the 5,000 ticks, so a program of that shape that recurses a little deeper stops at the tick limit although real Node would not.
- **Node-internal frames and the loop's real-time behavior** are constants and a virtual clock. JavaScript costs 0 virtual ms and the 60,000 ms virtual-time limit ends a run; real Node's time passes while code runs.

### Tiering model (Phase 4, Modeled)

- **Thresholds are budget values**: 8, 400 and 3000 times the function's bytecode length, which charges calls and back edges. For a function without loops they are call counts.
- **A site's first feedback never deopts.** A property IC going UNINITIALIZED to monomorphic, or a binary operation's first hint, only records feedback in optimized code; real V8 would soft-deopt there with `kInsufficientTypeFeedback`.
- **Unary operators are not hooked.** Inc, Dec, Negate and BitwiseNot share V8's binary-operation hint but feed the model nothing.
- **Turbofan is held back after a re-Maglev.** A Maglev tier-up sets a gate 3000 - 400 invocations ahead (`turbofanGate`), so a function that deopts and returns to Maglev does not reach Turbofan on its next call.
- **Real V8 tiers by budget; we use a bytecode-byte budget.** V8 spends an interrupt budget on its own schedule, and compiles Sparkplug in batches and Maglev/Turbofan concurrently. The model charges bytecode bytes against budget thresholds (multiples of the function's length), so the tier shown is a teaching approximation of when V8 would switch, not a recording of it.
- **Turbofan is practically unreachable by call count.** It needs 3000 calls, each costing at least a function-entry tick, against the 5,000-tick limit (ADR-027, ADR-028); in practice the limit stops the run first. A hot loop can still reach it by OSR (500 loop lengths of back edges).
- **Tier events can be lost only with no tick.** Events are drained onto the next recorded Tick, and events pending after the last one are attached to it by `finish()`. A run that records no tick at all drops them (ADR-034).
- **Machine code is Illustrative.** The asm is the Sparkplug-style template translation of the shown bytecode, and the bytes are the exact x64 encoding of the asm shown (checked against LLVM's MC layer: llvm-mc or clang, recorded with clang 23.1.4; ADR-036), not necessarily the bytes V8 would emit. Register values, pointers and stack addresses (ADR-033) are illustrative. The generator and runtime-call templates are the most illustrative: they follow V8's shape, not its code.
- **Machine-state flags exist only for `cmp` instructions.** `TestNull`, `TestUndefined` and `TestReferenceEqual` show a `cmp`, so they project flags; every other bytecode, including the other `Test*` ones that call a builtin, shows `flags: null` (ADR-033).
- **The Smi, register and pointer model is not Node's.** The panes show a 31-bit Smi in `rax` (`value << 1`) and a cage base in `r14`, while the pinned Node 24.19.0 / V8 13.6 build has pointer compression off and 32-bit Smis stored as `value << 32`, so `%IsSmi(2**30)` is true there and a value near 2**30 is a Smi in Node but a HeapNumber in the panes. Elements-kind consumers and the narration text "isn't a Smi" follow the 31-bit range (ADR-039).

#### Stops (`unsupported`)

Each of these ends the run with `Simulation stopped: <reason>` in `warnings` (never in stdout or stderr), keeping the output produced so far (ADR-027). The program is in the subset, and real Node would print something we do not reproduce. Fixtures that exercise a stop assert the kind, not the text.

| Area | Reasons |
|---|---|
| Printing (`util.inspect`, `console.*`) | `%j`, `%o`, `%O` directives; `%d`/`%i`/`%f` with an object argument (its `valueOf` would run); `%s` with a function, or with an object that has its own `toString`; `util.inspect` of an object-valued `toString`/name part, of an `arguments` object, of a Node `Timeout`/`Immediate`, of an object whose prototype chain has no constructor, of an error whose stack is not a string, whose name is not a string, or whose stack has more than 10 frames; the ICU display width of a character in a grouped array |
| Errors and rejections | printing an Error with extra own properties; a rejected Error constructed outside the script; an unhandled rejection whose reason is a non-Error object; `new Error(obj)` with an object message, and an Error name or message field that is an object; `AggregateError` from a non-array; `Error.prototype.toString` on a primitive |
| TypeError text | calling or `new`-ing a value through a callee that V8's CallPrinter prints as an intermediate value; a TypeError that would print an object key, an object comparison function, an array or an error, or a `then` that is an object; strict assignment to a read-only property or global; `delete` on a primitive or `null`/`undefined`; strict `delete` of a non-configurable property |
| Objects and arrays | assigning an object to an array's `length` (its `valueOf` runs twice); an element property with non-default attributes; a non-writable array length; `push` past the largest array length; `Array.prototype.*` on a receiver that is not an array; `sort` of 64 or more elements (TimSort's merge phase); `caller` and `arguments` of a running sloppy function |
| Promises | a promise whose constructor is not `%Promise%` (species); `Promise.all`/`race`/`allSettled`/`any` over an iterable that is not an array or a string |
| Strings, numbers, functions | a string longer than V8's maximum length; `Number.prototype.toString` with a radix other than 10; `Function.prototype.call`/`apply`/`bind` on a non-function; an `apply` argument list of more than 65,535 values |
| Node host | `process.nextTick`, `queueMicrotask`, `setTimeout`, `setInterval` or `setImmediate` with a callback that is not a function (`ERR_INVALID_ARG_TYPE` is not modeled); `clearTimeout`/`clearImmediate` on a non-timer; `Timeout.prototype.*` or `Immediate.prototype.*` on another receiver; calling or constructing Node's `Timeout`/`Immediate` class; a Node builtin member that is not modeled (`<Global>.<member>`) |
| Test-only | `%DebugPrint` of anything but a user function; `%Name` of a non-object; a test262 harness message that is an object |

#### Nondeterministic orderings

Real Node does not guarantee these orders; they depend on how many real milliseconds startup, callbacks or console writes took. The simulator never picks an order at random. JavaScript costs 0 virtual ms, so it always takes one branch, which is one of the outcomes recorded over many real runs, and it adds a fidelity warning to `warnings` (never to stdout or stderr), once per rule per run. The rules are in `core/host/nondeterminism.ts`; each names the fixture whose recording proves it.

| Rule | Situation | Fixture | Simulator's order |
|---|---|---|---|
| 1 | a `setTimeout(≤1)` and a `setImmediate` both pending when the loop starts | `timeout-vs-immediate-main` | the immediate first (first recorded outcome) |
| 2 | a timer list re-armed from a timer callback ties with another pending list | `timer-in-timer-ordering` (`A C A1 A0 B` in 46 of 50 runs, `A C B A1 A0` in 4) | the older list first |
| 3 | a timer armed after a console write that followed the arming of an earlier list, due within 5 ms of it | `timer-after-first-write` (the first write costs about 2.2 ms; a 4 ms gap flipped, a 5 ms gap did not; later writes still flipped a 2 ms gap in 10 of 40 runs, found by the differential run, seed 1350358517) | the earlier-armed list first |

A program outside these three rules that still has a racy order will be Exact in the order the simulator picks and may differ from a given real run; the rules cover the cases probed so far, not every race.

## How real bytecode is captured

`npm run conformance:record` captures the bytecode of every `kind: "program"` fixture that exits 0 or declares `expect: "run"`, in a second run of the fixture (`scripts/conformance/bytecode-capture.mts`). **The primary path shipped**; neither fallback (dropping `--permission`, name filters) was needed.

- **Run.** The fixture runs through the same sandbox as its recorded run (`--permission` with no grants beyond read access to `scripts/conformance/mark.cjs`, empty env, timeout, 64 MiB heap), plus `--print-bytecode --no-compact --no-flush-bytecode --require mark.cjs`. The output cap is raised to 32 MiB, because the listing includes ~100 Node-internal functions (about 1 MB even for a small program).
- **Root.** `mark.cjs` calls `__silicon_marker__()` just before Node compiles `main.cjs`/`main.cts`. The main script is the first `Parameter count 6` block after the marker block. The capture also checks that the 5-byte CJS wrapper block comes just before it.
- **Children.** Children are found by walking SharedFunctionInfo addresses from the root's constant pool to the matching block headers, never by name. `--no-compact` keeps SFIs from moving and `--no-flush-bytecode` keeps each function compiled once. An address that is compiled twice, or a block whose name differs from the pool entry, aborts the record. A function that was never called has no block and is left out of `children`.
- **`.cts` positions.** Node appends `\n\n//# sourceURL=file:///<temp dir>/main.cts` to a stripped `.cts`, so the main script's implicit `Return` position depends on the temp path. Positions that point into that appended text are moved back to the end of the program. The result is exactly what V8 prints for the same stripped text as `.cjs`, so a `.cts` and its whitespace-stripped `.cjs` give identical trees.
- **Failure.** Any surprise in the listing throws `BytecodeCaptureError` and aborts the record, naming the fixture. So does a capture run whose exit code is not among the recorded outcomes' exit codes: a run that took another path would leave out the functions it never reached. A capture is never partial.

## Bytecode operand differences

Opcode sequences match `--print-bytecode` except where this section says otherwise. Of the 88 fixtures with recorded bytecode, 83 are `exact`, 4 are `opcodes` (operand differences only, listed below) and 1 is `pending` (ADR-023, `tests/conformance/bytecode-status.json`). The ratchet after Task 12 (per-iteration `let` contexts, which made `bc-loop-let` and `closure-in-loop-let` exact) was 82 `exact`, 4 `opcodes` and 1 `pending` of 87; the added fixture, `timer-after-first-write`, is `exact`. Operand-level differences are listed here, per fixture.

- `bc-tdz-assign`, `assignFirst`: after an assignment to a not-yet-initialized binding inside a branch, V8 flushes the merge with `Ldar` of the temporary holding the value; we reload the binding. Same value, different register operand. The register optimizer's flush rule behind this is not yet understood.
- `bc-defaults` and `default-params`, `viaClosure`'s arrow: the header name of an arrow in a default initializer (`read = () => x`) is `x` in V8, the identifier read inside it, while its constant-pool entry stays `read`. We print `read` in both. Instructions are identical.
- `closure-counter`, `pair`'s first arrow: in `return [() => shared, (v) => (shared = v)]` V8's name inferrer runs at the later `shared = v` and names the earlier anonymous arrow `shared`, in its header and in the constant pool of `pair`. We leave it anonymous. Instructions are identical.
- Optional chain right after the statement that stored its object, e.g. `var o = null; o?.a;`: the accumulator still equals `r0`, so the `Ldar r0` is elided and V8 flushes the temporary with `Mov r0, r1` before `JumpIfUndefinedOrNull`; we print `Star1` (and every later jump offset shifts by 2). Seen only in hand-made probes, no recorded fixture hits it. The flush order of the accumulator against locals in the register optimizer is the suspect; moving the accumulator last fixes the probe but breaks `bc-optional`, so the real rule is something else.

An opcode difference (the generator does compile it; the fixture stays `pending`):

- `loose-equality-coercions`, `show("!!{}", !!{})` and its siblings: in a value context V8 compiles `!!x` to a single `ToBoolean`, while we print `ToBooleanLogicalNot` then `LogicalNot`, which shifts every later offset. The other three functions of the fixture are exact. The rule behind V8's choice, and whether it extends to `!!!x`, is not yet probed.

Not yet reproduced (the generator refuses them, so the fixture stays `pending`):

- An async function with default, rest or destructured parameters. V8 puts the generator object after the parameters' own locals and runs their initializers inside the try block that rejects the promise; the generator throws `NotYetSupported` rather than emit the plain-function order. Async functions with simple parameters match V8 exactly in every recorded fixture (`bc-async`, `async-await-order`, `await-thenable-two-extra-ticks` and the rest), with no operand differences.
- Generator functions (`function*`) are excluded before bytecode generation (`E_EXCLUDED_FEATURE`); the generator also refuses one itself, so it can never be compiled as a plain function.
- `while (z, c)`: the statement position of a comma-expression loop test differs from V8's.

One case is known and not reproduced: when a forward jump is still pending while the constant pool crosses 256 entries, V8 moves later entries to the next index slice to keep the jump's reserved index free; this generator appends them in order. A listing could differ only in a function with more than 256 constants and a jump over the crossing.
