# Phase 4: Baseline Machine Code & Tiering Model (Implementation Plan)

> Task 0 copies this file to `docs/superpowers/plans/2026-10-22-phase-4-baseline-tiering.md` and commits it before any code. Execute with `superpowers:subagent-driven-development`, one task per subagent.

## Context

Phases 0–3 are done: the bytecode is the single source of truth, the interpreter runs it with Node-exact output, and the timeline records statement-level ticks (ADR-028). Phase 3 is waiting for review. Its docs edits (ADR-025..032) are still uncommitted on `phase-3`. **Commit them or review them before branching `phase-4`.**

PROMPT §9 Phase 4 asks for four things:
- a Sparkplug-style `BaselineCompiler`, with one x86-64 template per bytecode
- a table-driven `X64Encoder`
- an `llvm-mc` cross-check
- a `TieringModel` with deopt events, and the asm and binary views

The machine code is **Illustrative**. The bytes are the **exact encoding of the shown asm**. Tiering is **Modeled**. None of it may ever influence the Exact layer.

**Done when (PROMPT §9):**
- The encoder golden tests pass, and every template form matches `llvm-mc`.
- A `fast-check` property shows that every asm and byte line maps to a bytecode offset.
- The register roles cite `register-x64.h` for the pinned V8.
- Tiering appears only with Modeled badges.

## Verified facts (probed 2026-10-22 on Node 24.19.0 / V8 13.6.233.17; do not re-derive)

- **`register-x64.h` @ 13.6.233.17:**
  - accumulator `rax`, context `rsi`, JS function `rdi`, `rsp` stack
  - bytecode offset `r9`, bytecode array `r12`, dispatch table `r15`
  - root `r13` (callee-save), pointer-compression cage base `r14`
  - scratch `r10`, argc `rax`, new.target `rdx`, return values `rax`/`rdx`/`r8`
- **Tiering flag defaults** (`node --v8-options`):

  | Flag | Default |
  |---|---|
  | `invocation-count-for-feedback-allocation` | 8 |
  | `invocation-count-for-maglev` | 400 |
  | `invocation-count-for-turbofan` | 3000 |
  | `invocation-count-for-osr` | 500 |
  | `invocation-count-for-maglev-osr` | 100 |
  | `minimum-invocations-after-ic-update` | 500 |
  | `minimum-invocations-before-optimization` | 2 |

  `--sparkplug`, `--maglev`, `--concurrent-sparkplug` and `--baseline-batch-compilation` (threshold 4096) are on by default.
- **Deopts are observable.** `%GetOptimizationStatus(f)` after 200k calls is `0b110001`, and after `f("x")` it is `0b1`.
- **Opcode coverage.** Real fixture bytecode uses **124 distinct opcodes**, plus the `Wide`/`ExtraWide` prefixes. The table has 208 (`core/bytecode/bytecodes.ts`).
- **Feedback.** Only property ICs are modeled (`core/runtime/ic/FeedbackVector.ts`). There is no binary-op feedback yet.
- **Reachability.** Under the 5,000-tick limit, Maglev (400 calls) is reachable for small functions. TurboFan (3000) practically is not, which goes into FIDELITY.
- **No assembler.** `llvm-mc` is **not installed**. `recursion-factorial` is at 4,880 of 5,000 ticks.

## LLVM install (the owner runs this later; Task 10 lands the script now, Task 18 records after the install)

```powershell
winget install --id LLVM.LLVM -e --source winget
# add to PATH for the current user, then open a new terminal
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Program Files\LLVM\bin", "User")
llvm-mc --version   # must print an LLVM version
```

Until LLVM is installed:
- `npm run asm:record` refuses with a clear message.
- `npm test` compares against the checked-in `tests/conformance/asm/encodings.expected.json`. Until the first record, that file is absent, and the golden test is `it.todo` with a tripwire (the same pattern as Phase 2's `SIMULATOR`).
- **The phase is not done until the file is recorded.**

## Decisions (become ADR-033+, flagged for review)

- **D1: Machine state is derived, not stored** (owner's ruling). It deviates from §7.5's `Tick.machine`.
  - A pure `machineStateAt(tick, baseline)` returns `{ asmLine, registers, flags }`.
  - `rax` is the tagged accumulator: a Smi is `value << 1` (31-bit Smis with pointer compression). A heap value gets an illustrative compressed pointer from its `ObjectId`.
  - `rsi` is the context and `rbp`/`rsp` the frame, both illustrative.
  - Flags are set only at a `Test*` site; otherwise they are `null`.
  - Ticks, `TimelineStore` and the 20 MB budget are unchanged.
- **D2: Tier events are not ticks** (owner's ruling). `TickBoundary` is untouched.
  - The Tick gains `v8.tiers: Record<FunctionId, Tier>` and an optional `v8.tierEvent`, both set on the tick where the change happens.
  - The narration names the change.
- **D3: Template coverage is exhaustive by type.**
  - `TEMPLATES satisfies Record<Opcode, Template>`, so a missing opcode is a compile error. That needs no test.
  - Opcodes Sparkplug handles out of line become `call` to the named builtin, `Builtin::k<Name>_Baseline`, as Sparkplug's `CallBuiltin` does.
  - Builtin calls are shown as `call [r13 + IsolateData::builtin_entry(k…)]`, which exercises REX.B and r13 disp8.
- **D4: The `llvm-mc` exception.** `child_process` is already allowed in `scripts/conformance/`, but ADR-008 scopes that exception to running node.
  - Widen it to "llvm-mc on repo-generated asm text".
  - Put the script at `scripts/conformance/asm-record.mts`, so the lint rule and its proof change only in wording.
- **D5: The TieringModel is an observer.** It lives in `core/interpreter/tiering/TieringModel.ts`.
  - It is fed by interpreter hooks: function entry, `JumpLoop` back edge, IC transition, and a new **Modeled** binary-op hint (`SignedSmall → Number → Any`) kept *only* in the model.
  - Thresholds are the flag table above, citing `src/flags/flag-definitions.h`. Sparkplug comes after feedback allocation (8 calls), Maglev at 400, TurboFan at 3000.
  - **A deopt** happens when an optimized function's speculation breaks: an IC gains a Map, or a hint widens. Reasons use V8's `DeoptimizeReason` names (`kWrongMap`, `kNotASmi`; `src/deoptimizer/deoptimize-reason.h`).
  - **Proof it never changes output:** the conformance suite runs with the model on and gives identical results.
- **D6: The `/api/compile` summary is unchanged** (ADR-032). Tiers reach the client only through its own worker (Phase 5).

## Working rules for this phase (owner's request)

- **Comments:** one line, the *why* or the V8 source it cites. Name the V8 file once per module header, and add no prose blocks.
- **Tests: only those that prove a done-when item or guard a real risk.** No snapshot tests, no per-opcode unit tests (type exhaustiveness plus the golden file cover them), and no tests of trivial getters. The full list is under "Tests that exist".
- **Probe, don't recall.** Encodings come from `llvm-mc` and the register roles and flags from the pinned V8. Never fill either from memory.

## How models are enforced (read before executing)

The main session is the **orchestrator**. It writes no feature code. It dispatches every task below to a **fresh subagent** with the Agent tool and passes that task's `model` and `effort` **explicitly**. This plan is the owner's explicit instruction to set `effort`, so it is always passed. This holds when the owner is away: a task never runs on the main session's model by default.

- **Main session.** Recommended: Sonnet, high (`/model sonnet`). The work that needs judgment goes to Opus subagents, so the orchestrator only dispatches, reads results and commits.
- **One task, one subagent, one commit.** The orchestrator gives each subagent:
  - the task block
  - the "Verified facts"
  - the "Working rules"
  - the exact files it may touch
- **Per-task review.** After each task, a review subagent runs with the model in the task's **Review** line. If it finds problems, the same implementer model fixes them once. If the task fails twice, it escalates to **Opus, high**.
- **Any conformance mismatch or `*.expected.json` diff:** stop. Dispatch **Opus, high** with `superpowers:systematic-debugging`, and never edit an expectation.
- **Order.** Tasks run in order. 2–3 may run in parallel with 1. 11 may run in parallel with 4–9, because it depends only on Task 0.

## Model and effort report (which model for which task)

| # | Task | Implement with | Review with | Why this model |
|---|---|---|---|---|
| 0 | Branch + plan commit | Haiku, low | none | Git only |
| 1 | x64 register roles | Sonnet, medium | Haiku, low | Transcribe + hash check, an existing pattern |
| 2 | Encoder core (forms, REX/ModRM, fixups) | **Sonnet, high** | **Opus, medium** | Bit-exact; an error here poisons every byte |
| 3 | AT&T / Intel printers | Sonnet, medium | Haiku, low | Mechanical formatting |
| 4 | Template interface + frame layout | **Opus, high** | none (orchestrator reads it) | Small output, sets every later contract |
| 5 | Templates A: loads, stores, registers, contexts | Sonnet, medium | Sonnet, low | Mechanical against Task 4's interface |
| 6 | Templates B: arithmetic, compare, jumps | Sonnet, medium | Sonnet, low | Same |
| 7 | Templates C: calls, properties, literals, generators, rest | Sonnet, medium | Sonnet, low | Same; most use the builtin-call shape |
| 8 | BaselineCompiler + asm/binary views + mapping property | Sonnet, medium | Sonnet, medium | Wiring; the property test catches mistakes |
| 9 | `machineStateAt` projection | **Sonnet, high** | Sonnet, low | Tagging arithmetic must be exact |
| 10 | `asm-record` script + offline golden test | Sonnet, medium | Haiku, low | Copies the `record.mts` pattern |
| 11 | TieringModel design | **Opus, high** | none (orchestrator reads it) | Exact-layer isolation, deopt semantics |
| 12 | TieringModel implementation + hooks | **Sonnet, high** | **Opus, medium** | Touches the interpreter hot path |
| 13 | Timeline integration (`v8.tiers`, narration) | Sonnet, medium | Sonnet, low | Small, typed change |
| 14 | ADRs, FIDELITY, ARCHITECTURE, PROMPT, CLAUDE.md | Sonnet, low | Haiku, low | Follows the existing ADR style |
| 15 | Full verification run | Haiku, low | none | Run and report only |
| 16 | Final bug and security review | **Opus, medium** | none | Your standing rule ([[final-opus-review]]) |
| 17 | Fix agreed review findings | Sonnet, medium | Haiku, low | Fixes are already specified |
| 18 | *(after LLVM install)* record the llvm-mc goldens | Haiku, low | none | Runs a command; on a mismatch, escalate to Sonnet, high |
| any | Conformance mismatch / debugging | **Opus, high** | — | Root cause, never patch the symptom |

**Totals:**
- **Opus:** 2 design tasks, 2 reviews, the final review, and debugging only.
- **Sonnet:** the bulk of the code.
- **Haiku:** git, runs and light reviews.

**What reduces hallucination:**
- Every subagent gets exact paths, the interfaces it produces and consumes, and the verified facts.
- Each task gets a fresh context.
- A task escalates to Opus only after failing twice.

## File structure

```
core/baseline/x64/registers.ts         Register enum + V8 roles (cites register-x64.h @13.6.233.17, sha256 checked like bytecodes.h)
core/baseline/x64/encodings.ts         the closed table of instruction forms the templates use
core/baseline/x64/Encoder.ts           two-pass assemble → bytes, label fixups; unknown form → Result err
core/baseline/x64/syntax.ts            AT&T (default) / Intel printers
core/baseline/templates/*.ts           per-family templates (loads, stores, arith, compare, jumps, calls, contexts, generators, …)
core/baseline/BaselineCompiler.ts      BytecodeFunction → BaselineCode { instructions: {asm, bytes, bytecodeOffset}[] } incl. prologue
core/baseline/machineState.ts          D1 projection
core/interpreter/tiering/TieringModel.ts   D5
core/views/{AsmView,BinaryView}.ts     CodeViewStrategy "asm" | "binary"
core/compile/CompilationManager.ts     (modify) views.asm, views.binary
core/interpreter/IgnitionInterpreter.ts (modify) tiering hooks
core/timeline/{Tick,TickRecorder,narration,simulate}.ts (modify) v8.tiers, tierEvent
scripts/conformance/asm-record.mts     llvm-mc → tests/conformance/asm/encodings.expected.json
tests/conformance/asm.test.ts          golden comparison (offline)
docs/{DECISIONS,FIDELITY,ARCHITECTURE}.md, PROMPT.md status, CLAUDE.md commands (asm:record)
```

## Tasks (one commit each, Conventional Commits)

Each block starts with its **Run with** line: the `model` and `effort` the orchestrator passes to the Agent tool.

### Task 0: Branch and plan commit
**Run with:** Haiku, low. **Review:** none.
- Precondition: the Phase 3 docs are committed (the owner's call).
- Create the `phase-4` branch from `phase-3` and commit this file: `docs: phase 4 plan`.

### Task 1: x64 register roles
**Run with:** Sonnet, medium. **Review:** Haiku, low.
- Fetch `register-x64.h` @13.6.233.17 and check its sha256 in under `tests/conformance/support/`.
- Write `core/baseline/x64/registers.ts` with the roles in "Verified facts".
- Test: `registers.test.ts` asserts the hash and the role table.

### Task 2: Encoder core
**Run with:** Sonnet, high. **Review:** Opus, medium.
- Build `core/baseline/x64/{encodings,Encoder}.ts`. The forms are:
  - `push`/`pop` r64
  - `mov` r/m64↔r64 and `mov r64, imm32/imm64`
  - `[rbp+disp8/32]`, plus `[r13+disp]`, which needs disp8 when the base is r13
  - `cmp` and `test`, `jcc`/`jmp` rel8/rel32, `call` m64, `ret`
- Use a two-pass assemble with label fixups. An unknown form is a `Result` error, not a fallback.
- Tests in `Encoder.test.ts`:
  - goldens `push %rbp=55`, `mov %rsp,%rbp=48 89 e5`, `pop %rbp=5d`, `ret=c3`
  - one rel8 → rel32 relaxation
  - an unknown form returns an error

### Task 3: AT&T / Intel printers
**Run with:** Sonnet, medium. **Review:** Haiku, low.
- Build `core/baseline/x64/syntax.ts`: AT&T by default, Intel as a toggle.
- No new test; Task 10's golden test compares the AT&T text.

### Task 4: Template interface and frame layout
**Run with:** Opus, high. **Review:** the orchestrator reads it.
- Define the `Template` type, the `BaselineCode` type (`{ instructions: { asm, bytes, bytecodeOffset }[] }`) and the frame layout.
  - The bytecode registers are `[rbp - 8*(k+N)]`.
  - The prologue and epilogue follow Sparkplug's out-of-line prologue.
  - `Wide`/`ExtraWide` are folded into the operand.
  - The builtin-call shape is `call [r13 + IsolateData::builtin_entry(k…)]` (D3).
- Write `TEMPLATES satisfies Record<Opcode, Template>` as a stub table: every opcode maps to the builtin-call template, so Tasks 5–7 only replace entries.
- **Output:** the types and one worked example (`Ldar`, `Add`, `JumpIfFalse`), with no other templates.

### Task 5: Templates A (loads, stores, registers, contexts)
**Run with:** Sonnet, medium. **Review:** Sonnet, low.
- Cover `Lda*`, `Star*`, `Ldar`, `Mov`, `*ContextSlot`, `PushContext`/`PopContext` and `LdaGlobal`/`StaGlobal`, in `core/baseline/templates/loads.ts` and `contexts.ts`.
- No per-opcode tests.

### Task 6: Templates B (arithmetic, compare, jumps)
**Run with:** Sonnet, medium. **Review:** Sonnet, low.
- Cover `Add`/`Sub`/`Mul`/… and their `*Smi` forms, `Test*`, `Jump*`, `JumpLoop` and `Return`, in `templates/arith.ts` and `jumps.ts`.

### Task 7: Templates C (calls, properties, literals, generators, the rest)
**Run with:** Sonnet, medium. **Review:** Sonnet, low.
- Cover `Call*`, `Construct`, `Get*/Set*/Define*Property`, `Create*Literal`, `CreateClosure`, `Throw`/`ReThrow`, `SwitchOnGeneratorState`, `Suspend`/`ResumeGenerator`, `InvokeIntrinsic` and `CallRuntime`.
- Opcodes the generator never emits keep the stub builtin call.

### Task 8: BaselineCompiler, asm/binary views, mapping property
**Run with:** Sonnet, medium. **Review:** Sonnet, medium.
- Build `core/baseline/BaselineCompiler.ts` and `core/views/{AsmView,BinaryView}.ts`, and wire them into `CompilationManager` (`views.asm`, `views.binary`).
- **One `fast-check` property** over generated subset programs and every fixture: each asm/binary line's `positions` is a valid `(functionId, bytecodeOffset)`, and every bytecode offset has ≥1 asm line.
- Check the compile-worker bundle size (`scripts/build-worker.mts`).

### Task 9: `machineStateAt` (D1)
**Run with:** Sonnet, high. **Review:** Sonnet, low.
- Build `core/baseline/machineState.ts`.
- Test: one test on `nexttick-vs-promise` ticks checks that `asmLine` is in range and that the tagged `rax` equals the accumulator's Smi `<< 1`.

### Task 10: llvm-mc record script and offline golden test (D4)
**Run with:** Sonnet, medium. **Review:** Haiku, low.
- `scripts/conformance/asm-record.mts` collects every distinct encoded form, runs `llvm-mc --show-encoding` (AT&T) and writes `tests/conformance/asm/encodings.expected.json`. Without `llvm-mc` it refuses with the install command.
- `asm.test.ts` compares offline and fails on any form missing from the file. Until the first record it is `it.todo` with a tripwire.
- Widen ADR-008's wording, add the `asm:record` npm script, and update the lint-proof wording.

### Task 11: TieringModel design (D5)
**Run with:** Opus, high. **Review:** the orchestrator reads it.
- Define:
  - the hook interface (`onInvoke`, `onBackEdge`, `onIcTransition`, `onBinaryOp`)
  - `Tier = "ignition" | "sparkplug" | "maglev" | "turbofan"`
  - `TierEvent`, with tier-up and deopt and a `DeoptimizeReason` name
  - the thresholds table, citing `flag-definitions.h`
  - the rule that every output field carries `truth: "modeled"`
- Write down how the Exact layer stays isolated: the hooks are fire-and-forget and return `void`.
- **Output:** types plus a short design note at the top of `core/interpreter/tiering/TieringModel.ts`.

### Task 12: TieringModel implementation and interpreter hooks
**Run with:** Sonnet, high. **Review:** Opus, medium.
- Implement Task 11's design. Wire the hooks into `IgnitionInterpreter` and the property IC transitions, and add the model-local binary-op hint.
- Tests in `TieringModel.test.ts`:
  - transitions at 8 and 400 calls
  - `kWrongMap` when a 2nd Map hits a Maglev function's IC
- **Proof it never changes output:** `npm run conformance` stays green with the model on.

### Task 13: Timeline integration (D2)
**Run with:** Sonnet, medium. **Review:** Sonnet, low.
- Add `v8.tiers` and `v8.tierEvent` to `Tick`, set them in `TickRecorder`, and add narration such as "f would typically tier up to Maglev after 400 calls (Modeled)".
- Add no new tests. The existing `TimelineStore` budget and tick-budget tests must pass unchanged.

### Task 14: Docs
**Run with:** Sonnet, low. **Review:** Haiku, low.
- Write ADR-033..038 (D1–D6).
- Add the FIDELITY rows:
  - asm is Illustrative, and the bytes are the exact encoding of the shown asm
  - tiering is Modeled
  - TurboFan can't be reached under the tick limit
  - real V8 tiers by budget; we count invocations
  - the generator templates are the most illustrative
- Update the ARCHITECTURE "Phase 4" section, the PROMPT status line and the CLAUDE.md command table.

### Task 15: Full verification
**Run with:** Haiku, low. **Review:** none.
- Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run conformance` and `npm run build`. Report the output verbatim.
- Any failure goes back to the orchestrator, which dispatches a fix by the failing task's model.

### Task 16: Final review
**Run with:** Opus, medium. **Review:** none.
- Run a bug and security review of the phase diff, with special attention to Exact-layer isolation and the `child_process` scope.

### Task 17: Fix the agreed findings
**Run with:** Sonnet, medium. **Review:** Haiku, low.
- Fix the findings the orchestrator accepted, list the rejected ones with reasons, then re-run Task 15.

### Task 18: Record llvm-mc goldens (after the owner installs LLVM)
**Run with:** Haiku, low. **Review:** none. On a mismatch, escalate to Sonnet, high, and never edit the golden by hand.
- Run `npm run asm:record` twice; the second run must leave no diff.
- Confirm that `asm.test.ts` is no longer a todo, and commit.
- Then report and **stop for review**.

## Tests that exist (and nothing more)

| Test | Proves |
|---|---|
| `registers.test.ts` | the roles cite the pinned `register-x64.h` (hash + table) |
| `Encoder.test.ts` | the 4 golden bytes, jump relaxation, unknown form → error |
| `asm.test.ts` | every form matches `llvm-mc` (the recorded golden) |
| `views` property | every asm/byte line maps to a bytecode offset, and every offset has asm |
| `machineState.test.ts` | the projection is consistent with the tick |
| `TieringModel.test.ts` | thresholds, a deopt reason, Modeled badge on every tier field |
| existing conformance + timeline suites | tiering never changes output; tick and size budgets hold |

## Verification

1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run conformance` and `npm run build`. Show all output, with zero `*.expected.json` diffs.
2. After the LLVM install, run `npm run asm:record` twice. The second run must leave no diff, and `asm.test.ts` must stop being a todo.
3. Run `simulate()` on a 400-call loop fixture and inspect it: `v8.tiers` reaches `maglev`, a later Map change gives a `deopt` event, and stdout is unchanged versus the model off.
4. Run the Opus (medium) review subagent on the phase diff, fix the agreed findings, then report and stop for review.

## Open risks

- `recursion-factorial` has only 120 ticks of headroom; D2 keeps it safe.
- Templates for the generator opcodes (`SwitchOnGeneratorState`, `SuspendGenerator`) are the most illustrative ones. Mark them so in FIDELITY.
- Bundling: the `core/baseline` additions grow the compile-worker bundle (`scripts/build-worker.mts`). Check the size in Task 9.
