# Phase 7: V8 Internals View and 3D Hardware (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two Phase 6 placeholders in the bottom panel with real views:
- **V8 Internals:** the frame inspector, hidden-class graph, IC table, elements-kind lattice, heap strip and tier timeline.
- **Hardware:** the R3F board and an SVG fallback that the same data drives.

Both views keep their truth badges, cost nothing on first load, and the 3D board renders no React commits per tick.

**Architecture:** The UI only renders, as in Phase 6.
- Data that needs the whole timeline (tier history, the hardware trace with cache hits and misses) is computed **once in the worker** by pure `core/` functions and posted on the `simulated` response, next to `markers`.
- The data for one tick comes from `useV8State()` (2D views) or `useHardwareFrame()` (3D and SVG boards, through refs, with zero renders).
- Layout of the graphs (transition tree, lattice) is a pure function in `features/v8-internals/model/`, tested in Node.
- Each view loads through `next/dynamic(…, { ssr: false })` only when its tab opens, so `three`, R3F and the graph code stay out of the first load (ADR-062).

**Tech Stack:** Next.js 16.3.8, React 19.2.8, `three` 0.186, `@react-three/fiber` 9, `@react-three/drei` 10 (`AdaptiveDpr` and `PerformanceMonitor` only), `r3f-perf` (new, lazy), Motion 14 for the 2D internals, Zustand 5, Vitest 5 + jsdom, Playwright + `@axe-core/playwright`.

**Spec:** `PROMPT.md`:
- §9 Phase 7
- §8.3 "V8 Internals view", "3D Hardware board (R3F)" and "Accessibility"
- §3.2 (truth levels) and §7.4 (the runtime model)
- §2 principles 3, 9 and 10

Also `PRODUCT.md` and `DESIGN.md`. ADR-033 (machine state is derived), ADR-034, ADR-037, ADR-039, ADR-044, ADR-048 (no SSR `style=`), ADR-060 (the mobile popover is deferred to here), ADR-061 (predict-first) and ADR-062 (bundle) constrain this phase and **win where they conflict**.

## Context

- Phase 6 is done on `phase-6`, HEAD `ac3a38d`, and the tree is clean.
- **Contracts this phase consumes and must not break:**
  - `Tick.v8: V8Snapshot`, with `maps`, `changedMapId`, `feedback`, `elementsKinds`, `heap` and the optional `tiers`/`tierEvents` (`core/timeline/Tick.ts`)
  - `FrameSnapshot.registers`/`accumulator: ValueSnapshot`, where a Smi carries `tagged`
  - `machineStateAt(tick, baseline): MachineState | null` (`core/baseline/machineState.ts`, ADR-033)
  - `RegisterRoles` and `REGISTER_HEADER_SOURCE` (`core/baseline/x64/registers.ts`)
  - the `TieringModel` types `Tier`, `TierEvent`, `ModeledTiers` and `DEOPTIMIZE_REASON_MESSAGES`
  - `useV8State()` and `useHardwareFrame(onFrame?)` (`features/playground/hooks/`)
  - `TruthBadge`, `lazy.ts`, and `BottomPanel` with its `BottomTab` (`"event-loop" | "v8" | "hardware"`)
  - the `simulated` response and its `markers` (ADR-041)
- **This phase replaces** the two `PlaceholderPanel` uses in `BottomPanel.tsx`. `PlaceholderPanel.tsx` is deleted once neither uses it.

**Done when (PROMPT §9 Phase 7):**
- The "hidden classes" and "elements kinds" examples show transitions that match their V8-natives fixtures (Task 2).
- The 3D view holds a steady ~60 fps at 2×, measured with `r3f-perf` (Task 11).
- No React renders happen per tick in the hardware views (Tasks 8, 9 and 11).
- The fallback renders with WebGL disabled (Task 11).

## Verified facts (probed 2026-10-26 in this repo; do not re-derive)

- **Packages.**
  - `three` ^0.186.1, `@react-three/fiber` ^9.8.1 and `@react-three/drei` ^10.7.9 are installed.
  - `r3f-perf` is **not** installed.
- **The example fixtures exist and are recorded:** `tests/conformance/fixtures/hidden-classes-shapes.cjs` and `elements-kinds-lattice.cjs`, both with `*.expected.json`. They are natives-free.
- **The internals fixtures** (`tests/conformance/internals/`) are:
  - `maps-same-shape-vs-order`
  - `maps-field-generalization`
  - `elements-kinds-transitions`
  - `ic-states`

  Each has a `.meta.json` of `{ "nodeArgs": ["--allow-natives-syntax"] }`. `internals.test.ts` runs every internals fixture through **our simulator in natives mode** and compares it with the recording. `maps-replay.test.ts` replays three of them through the Map model.
- **The natives allowlist** (`core/shared/natives.ts`) includes `HaveSameMap`, `HasSmiElements`, `HasDoubleElements`, `HasObjectElements`, `HasHoleyElements`, `HasDictionaryElements` and `DebugPrint`.
- **`ElementsKind`** has 7 members: the 3 PACKED kinds, their 3 HOLEY counterparts, and `DICTIONARY_ELEMENTS`.
- **The Tick has no `machine`, `cache`, `bus` or `alu` field.** Machine state is derived (ADR-033). Tier changes are not ticks; they ride `v8.tierEvents` (ADR-034).
- **`useHardwareFrame`** already holds `{ tick, machine }` in a ref. It subscribes to `[playback.index, compile.timelineVersion]` and calls `onFrame` with no React render.
- **Recording** needs Node 24.19.0. The local runtime is 24.22.1. Phase 6 Task 4 recorded through `npx -y node@24.19.0 …`; reuse that invocation.
- **The budget.** First-load JS for `/playground` is 252.8 KB gz with the `noModule` chunk, and 214.2 KB for modern browsers (ADR-062). This phase must add **0 KB** to it.
- **The last ADR is ADR-062.** This phase starts at **ADR-063**.

## Decisions (become ADR-063+, flagged for owner review)

- **D1: Whole-timeline data is computed in the worker and posted once.**
  - Two new pure `core/` functions:
    - `tierTimeline(ticks)` (in `core/interpreter/tiering/tierTimeline.ts`)
    - `traceHardware(ticks, baselines)` (in `core/hardware/traceHardware.ts`)
  - Their results join `markers` on the `simulated` response.
  - The main thread never scans the timeline. Per-tick values (frame, maps, feedback, heap) still come from the Tick, so nothing is stored twice.
  - This extends ADR-033: the illustrative `cache`, `bus` and `alu` from §7.5 are **derived, not stored on the Tick**.
- **D2: The Illustrative hardware model.**
  - `classifyInstruction(ins)` maps every instruction form the baseline compiler emits to an ALU op and a memory access. The switch is exhaustive over the encoder's form table, as ADR-035 does.
  - **Addresses** come from `MachineState`: a stack slot is `rbp` plus an offset, and a heap object is its illustrative compressed pointer.
  - **The caches** are a deterministic LRU with 64-byte lines: L1 has 8 lines and L2 has 32. A miss in both counts as RAM.
  - This is Illustrative and says so. It never touches the Exact layer.
- **D3: The natives twin.** An example proves its transitions through a **twin** in `tests/conformance/internals/`:
  - The twin is the example's source with probe lines added after each `console.log` of interest. A probe line is `console.log("probe <n>", %HaveSameMap(x, y))` or `console.log("probe <n>", kind(list))`.
  - Twins are recorded on real Node with `--allow-natives-syntax`.
  - A test checks that the twin minus its probe lines equals the example byte for byte, and that our timeline answers every probe the way V8 did (Task 2).
- **D4: The 3D board reads refs only.**
  - Scene objects mutate in `useFrame` from the `useHardwareFrame` ref.
  - `frameloop="demand"` is used while paused and `invalidate()` is called from `onFrame`. While playing, the frame loop is `"always"`.
  - When the Hardware tab is hidden or the document is hidden, the frame loop is `"never"`.
  - Labels are `CanvasTexture` sprites drawn once. There is no drei `Text` (troika spawns a blob worker) and no drei `Html`.
- **D5: Choosing the board.** `HardwareView` picks:
  - **the SVG board** when WebGL is unavailable, when the context is lost, when the viewport is under 768 px (§8.3: 3D is off on mobile), or when the learner chose 2D
  - **R3F** otherwise

  The choice is a toggle stored in `localStorage["sl_hw_view"]`, with reads and writes in `try`/`catch`. The SVG board subscribes to the same ref and sets attributes through refs, so it also renders nothing per tick.
- **D6: Performance is measured, not assumed.**
  - `?perf=1` lazily mounts `r3f-perf`'s `<Perf>` inside the canvas, in any build. The chunk loads only with that query.
  - `e2e/hardware-perf.spec.ts` runs only when `PERF=1`, because headless SwiftShader fps means nothing. It plays at 2× for 10 s on a real GPU (headed) and reads the average fps from `r3f-perf`. Task 7 verifies the exact export name.
- **D7: Predict-first stays airtight (ADR-061).** In interview mode, until reveal, the frame inspector shows string register values as `"…"` (string, hidden) and object previews as `{…}`. Everything else stays visible. The owner confirms this in Task 1.

## Global Constraints

- **Never execute user code.**
  - No `eval`, no `new Function` and no blob scripts of our own.
  - Values render as text nodes or SVG `<text>`, never through `dangerouslySetInnerHTML`.
  - `npm run build`'s `scripts/check-build.mts` stays green with `three` and R3F in the output.
- **CSP (ADR-048).**
  - No SSR `style=`. Every new view is `ssr: false`.
  - Inline styles are set only on the client, through CSSOM or refs.
  - Production never gains `'unsafe-inline'` or `'unsafe-eval'`.
- **Layers.**
  - `core/` additions are pure and deterministic, with Node-environment tests.
  - `features/v8-internals/` and `features/hardware-3d/` import only `core/`, `components/`, `lib/` and `features/playground/hooks|store`.
  - If ESLint needs the new folders listed, extend `tests/tooling/eslint-boundaries.test.ts`.
- **Render isolation (principle 9).**
  - The 2D internals read `useV8State()` and the `compile.*` selectors with shallow equality.
  - **The 3D and SVG boards render zero React commits on a seek or during play.**
- **The budget.** `/playground` first-load JS is unchanged from ADR-062 (± 0.5 KB). `three`, R3F, drei, `r3f-perf` and the internals views live only in lazy chunks.
- **Truth badges** (§3.2), on every panel, with the exact `TRUTH_TOOLTIPS` text:

  | Panel | Badge |
  |---|---|
  | Frame inspector | Verified model (values Exact, tagging Verified model, ADR-039) |
  | Hidden-class graph | Verified model |
  | IC table | Verified model for the slot kinds in `ic-states.cjs`, otherwise Modeled per row |
  | Elements-kind lattice | Verified model |
  | Heap strip | Illustrative |
  | Tier timeline | Modeled, with "would typically…" wording |
  | Hardware board (3D and SVG) | Illustrative |

- **Color roles** (DESIGN.md):
  - semantic tokens only, never raw hex
  - the current item is green
  - deopts and errors are red
  - a cache hit is green and a miss red, **always with a text label or an icon**
  - a new token goes into both themes and into `tests/tooling/contrast.test.ts` at 4.5:1 or better
  - the 3D materials read colors from the CSS tokens at mount, through `getComputedStyle`, so both themes work
- **Motion.** Only `motion/react`, animating `transform` and `opacity`, with `MotionConfig reducedMotion="user"`. Under reduced motion, the 3D bus pulses and flashes become instant color changes.
- **Accessibility.** WCAG 2.2 AA.
  - The graphs have a text alternative: the hidden-class graph has a `<table>` view toggle, and the lattice nodes are `<li>` with `aria-current`.
  - The canvas has `role="img"` and an `aria-label` that names the current instruction and registers, updated through a ref.
  - The axe pass is clean.
- **TypeScript.** Strict mode and no `any`. Every `switch` over `ElementsKind`, `Tier`, `AluOp`, `BusKind` or `HardwareViewMode` is exhaustive with `never`.
- **Comments.** One line, short and precise: the *why* or the ADR it relies on. No narration of what the code does.
- **Tests.**
  - A test proves a done-when item or a Review Focus risk. No snapshot tests and no tests of trivial setters.
  - A task runs **only its own test files** (`npx vitest run <paths>`). The full `lint`/`typecheck`/`test`/`build`/`conformance` run happens once, in Task 14.
- **Commits.** One Conventional Commit per task, ending with the `Co-Authored-By` trailer from the session's attribution reminder.

## Review Focus

1. **WebGL disappears.** A context lost mid-playback, or a browser without WebGL, must not throw or leave a blank panel. The view switches to the SVG board with the notice "3D unavailable; showing the 2D board" (Tasks 7 and 11).
2. **A new program arrives while a board is mounted.** The `hardware` trace, `tierTimeline` and `baselines` of the old job must not be read at an index past the new length. Every ref read clamps or returns `null`, and the boards reset (Tasks 3 and 8: a test swaps in a 3-tick timeline while index 30 of a 40-tick one is shown).
3. **A big program.** 400 lines, about 80 functions, more than 200 Maps and more than 100 feedback slots:
   - the tier timeline and the IC table show 50 rows, then "Show all N"
   - the hidden-class graph caps at 128 nodes around the current Map, with a "+N more Maps" note
   - the 3D memory cells use one `InstancedMesh` with a fixed count

   (Tasks 4 and 6.)
4. **Leaked GPU memory.** Toggling 3D and 2D or switching tabs repeatedly must not grow geometries or materials. The shared resources are reference-counted and disposed on the last release (Task 8: a Node test of the registry).
5. **Predict-first leaks the answer.** In interview mode, the frame inspector must not show the string that `console.log` is about to print (D7, Task 5).

---

## File Structure

```
core/interpreter/tiering/tierTimeline.ts (+test)        D1: TierTrack[] per function
core/hardware/{classifyInstruction,cacheModel,traceHardware}.ts (+tests)   D1, D2
core/runtime/ic/verifiedSlotKinds.ts (+test)            slot kinds covered by ic-states.cjs
features/playground/worker/{protocol,handleRequest}.ts  simulated += tiers, hardware
features/playground/store/playgroundStore.ts            compile.tierTracks, compile.hardware
features/playground/hooks/useHardwareFrame.ts           frame += hw step (clamped)
tests/conformance/internals/{hidden-classes-shapes-natives,elements-kinds-lattice-natives}.cjs (+meta, +expected)
tests/conformance/example-internals.test.ts             D3 correspondence
features/v8-internals/
  model/{transitionLayout,latticeModel,icRows,heapStrip,frameRows}.ts (+tests)
  components/{V8InternalsView,FrameInspector,HiddenClassGraph,IcTable,ElementsLattice,HeapStrip,TierTimeline}.tsx
  v8Internals.test.tsx
features/hardware-3d/
  HardwareView.tsx  webgl.ts  useHwViewMode.ts
  board/{HardwareCanvas,CpuDie,RegisterBank,Alu,Caches,Ram,Buses,labels,boardResources,boardColors}.ts(x)
  svg/SvgBoard.tsx
  perf/PerfOverlay.tsx
  hardware.test.tsx  boardResources.test.ts
features/playground/components/{lazy.ts,bottom/BottomPanel.tsx,playback/PlaybackBar.tsx,panes/BytecodePane.tsx}   (modify)
e2e/{playground-internals.spec.ts,hardware-fallback.spec.ts,hardware-perf.spec.ts}
docs/{DECISIONS,FIDELITY,ARCHITECTURE}.md  DESIGN.md  PROMPT.md status
```

## Model and effort per task

The main session is the **orchestrator**. It dispatches each task to a fresh subagent and passes the `model` and `effort` below **explicitly**. A task never runs on the main session's model by default.
- After each task, a review subagent runs with the **Review** model.
- If the review finds problems, the same implementer model fixes them once. A task that fails twice escalates to **Opus, high**.
- Any conformance mismatch: stop, and dispatch **Opus, high** with `superpowers:systematic-debugging`.

| # | Task | Run with | Review with | Why |
|---|---|---|---|---|
| 0 | Branch + plan commit | Haiku, low | none | Git only |
| 1 | `impeccable shape` + owner decisions | **Opus, medium** | none (the owner reviews) | Layout of dense views, D5 and D7 need judgement |
| 2 | Natives twins + correspondence test | **Sonnet, high** | **Opus, medium** | The phase's fidelity proof; recording rules |
| 3 | Core: tier timeline, hardware trace, protocol | **Sonnet, high** | **Opus, medium** | New Illustrative model; worker contract |
| 4 | Internals view-models (pure) | Sonnet, medium | Sonnet, low | Small pure functions with tests |
| 5 | Frame inspector, IC table, lattice | **Sonnet, high** | Sonnet, medium | Predict-first, slot links, badges |
| 6 | Hidden-class graph, heap strip, tier timeline | **Sonnet, high** | Sonnet, medium | SVG graph and Motion |
| 7 | R3F foundation: lazy canvas, WebGL detection, CSP and build spike | **Sonnet, high** | **Opus, medium** | Production-only CSP and build risks |
| 8 | 3D board scene | **Sonnet, high** | **Opus, medium** | Zero renders, disposal, performance |
| 9 | SVG fallback board | Sonnet, medium | Sonnet, low | Same data, simpler surface |
| 10 | Bottom panel wiring + mobile pass (ADR-060) | Sonnet, medium | Sonnet, low | Integration, small |
| 11 | Done-when e2e + perf measurement | **Sonnet, high** | **Opus, medium** | The phase's proof |
| 12 | impeccable critique/audit/detect, fix batch, 4 widths | **Opus, medium** | Sonnet, medium | Design judgement |
| 13 | Docs: ADR-063+, FIDELITY, ARCHITECTURE, DESIGN.md | Sonnet, low | Haiku, low | Follows the existing style |
| 14 | Full verification run | Haiku, low | none | Run and report only |
| 15 | Final bug and security review | **Opus, medium** | none | Standing rule (final Opus review) |
| 16 | Fix agreed findings, re-verify, report | Sonnet, medium | Haiku, low | The fixes are already specified |
| any | Debugging a failing test or mismatch | **Opus, high** | — | Root cause first |

**Order.** Tasks run in order, with these exceptions:
- Tasks 2, 3 and 7 may run in parallel once Task 1 is done.
- Task 4 may run in parallel with Task 3.
- Tasks 5 and 6 may run in parallel once Tasks 3 and 4 are done.
- Task 9 may run in parallel with Task 8 once Task 7 is done.

---

### Task 0: Branch and plan commit
**Run with:** Haiku, low. **Review:** none.

- [ ] `git checkout -b phase-7` from `phase-6`, then commit only this file: `docs: phase 7 plan`.

**Done when:** `git log -1 --oneline` shows `docs: phase 7 plan` on `phase-7`, and `git status --short` is empty.

---

### Task 1: `impeccable shape` and owner decisions
**Run with:** Opus, medium. **Review:** the owner.

**Files:**
- Create: `docs/design/internals-hardware-shape.md`

- [ ] **Step 1:** Run `impeccable shape` for the V8 Internals and Hardware tabs (Operate mode), with `DESIGN.md`, `PRODUCT.md`, §8.3 and the Phase 6 brief as inputs. The brief fixes:
  - the internals layout at 1280 and 1440 px (six panels: which are side by side, which collapse, the order of reading)
  - the 768 px and 375 px stacks
  - the empty states that teach. For example, with no objects yet: "No objects yet: hidden classes appear when your code creates one."
  - the board composition: the die, register bank, ALU, L1/L2, RAM regions and buses, with the camera fixed and no orbit controls by default
  - where each badge sits
- [ ] **Step 2:** Ask the owner, in one `AskUserQuestion` call:
  1. D7: are the predict-first masking rules right?
  2. D5: should 3D be the default on desktop, or should the SVG board be the default, with 3D opt-in?
  3. ADR-062: does the budget count the `noModule` chunk? This sets the Task 10 gate.
  4. Allow orbit controls (drag to rotate), or keep a fixed camera?

  Record the answers at the top of the brief, and update D5 and D7 here if they differ.
- [ ] **Step 3:** Commit: `docs(design): internals and hardware shape brief`.

**Done when:** the brief exists with the owner's answers, and every §8.3 panel in this phase has a section.

---

### Task 2: Natives twins and the correspondence test
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create:
  - `tests/conformance/internals/hidden-classes-shapes-natives.cjs` (+`.meta.json`)
  - `tests/conformance/internals/elements-kinds-lattice-natives.cjs` (+`.meta.json`)
  - their `*.expected.json` (**recorded only**)
  - `tests/conformance/example-internals.test.ts`
  - `tests/conformance/helpers/consoleCallArgs.ts`

**Interfaces — Produces:**
- **The twins (D3).** Each is the example fixture's source with probe lines added; nothing else changes.
  - The hidden-classes twin probes, right after each existing `console.log(x, y)`: `console.log("probe <n>", %HaveSameMap(x, y))`. These are three pairs: `a, b` / `sameOrder, otherOrder` / `a, b` after `b.z`.
  - The elements twin defines `kind()` exactly as `elements-kinds-transitions.cjs` does, at the **end** of the file, where hoisting makes it visible. After each `console.log(list…)` it adds `console.log("probe <n>", kind(list))`.
- `consoleCallArgs(timeline, sourceLine: number, occurrence = 0): ValueSnapshot[]`. It finds the tick that executes the `console.log` call on that line (its `CallProperty*` bytecode) and returns its argument registers, read from the frame.
- `stripProbes(source: string): string` removes the lines that match `/^console\.log\("probe \d+"/` and the trailing `kind` definition.

- [ ] **Step 1:** Write both twins, then record them **on the pinned runtime only** (`npx -y node@24.19.0 … scripts/conformance/record.mts <name>`, the Phase 6 invocation). If that fails, **stop and ask the owner** to record. Never write `*.expected.json` by hand.
- [ ] **Step 2:** `npx vitest run tests/conformance/internals.test.ts` → the two twins pass through our simulator in natives mode. If one fails, that is a model bug: escalate to Opus, high.
- [ ] **Step 3: Failing test** (`example-internals.test.ts`):
  - `stripProbes(twin) === exampleSource`, for both pairs (drift guard)
  - **hidden classes:** for each probe `n`, the two object arguments of the matching example `console.log` have equal `mapId` **iff** the recorded twin prints `probe n true`
  - **elements kinds:** for each probe `n`, `tick.v8.elementsKinds[arg.id]` at the matching call equals the recorded kind string
  - **the view agrees:** at the last probe of each example, `transitionLayout(tick.v8.maps)` (Task 4) contains both `mapId`s, and `latticeModel(kind)` highlights the recorded kind
- [ ] **Step 4:** Implement the helpers, then run `npx vitest run tests/conformance/example-internals.test.ts` → PASS. Until Task 4 lands, the view assertion is the one allowed `it.todo`; Task 4 turns it on.
- [ ] **Step 5:** Commit: `test(conformance): natives twins prove the internals examples`.

**Done when:** both twins are recorded from real Node and pass `internals.test.ts`, and the correspondence test passes.

---

### Task 3: Tier timeline, hardware trace and protocol (core + worker)
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create:
  - `core/interpreter/tiering/tierTimeline.ts` (+test)
  - `core/hardware/classifyInstruction.ts` (+test)
  - `core/hardware/cacheModel.ts` (+test)
  - `core/hardware/traceHardware.ts` (+test)
- Modify:
  - `features/playground/worker/protocol.ts`, `handleRequest.ts` (+test)
  - `features/playground/store/playgroundStore.ts` (+test)
  - `features/playground/hooks/useHardwareFrame.ts` (+test)

**Interfaces — Produces:**
```ts
// core/interpreter/tiering/tierTimeline.ts (Modeled)
type TierSegment = { from: number; tier: Tier };            // tick index where this tier starts
type TierTrack = { functionId: FunctionId; functionName: string; segments: TierSegment[]; deopts: { index: number; reason: DeoptimizeReason }[] };
function tierTimeline(ticks: readonly Tick[]): TierTrack[];  // sorted by first-seen tick; [] when no tick has `v8.tiers`

// core/hardware/* (Illustrative)
type AluOp = "add" | "sub" | "and" | "or" | "xor" | "shl" | "sar" | "cmp" | "test" | "inc" | "dec" | "neg" | "imul";
type BusKind = "fetch" | "read" | "write";
type MemRegion = "code" | "stack" | "young" | "old";
type MemAccess = { kind: BusKind; region: MemRegion; address: bigint };
function classifyInstruction(ins: Instruction): { alu: AluOp | null; access: Omit<MemAccess, "address"> & { operand: "stack" | "heap" | "code" } | null };
type CacheLevel = "l1" | "l2" | "ram";
class CacheModel { access(address: bigint): CacheLevel }    // L1 8 lines, L2 32, 64-byte lines, LRU
type HardwareStep = { alu: AluOp | null; bus: { kind: BusKind; region: MemRegion } | null; servedBy: CacheLevel | null; l1: readonly number[]; l2: readonly number[] };
function traceHardware(ticks: readonly Tick[], baselines: readonly BaselineCode[]): HardwareStep[];  // one per tick
```
- `classifyInstruction`'s switch is exhaustive over the encoder's form table (ADR-035). A new form that is not classified fails typecheck.
- `l1` and `l2` are the line tags resident **after** the access, oldest first. They let the boards draw the cache contents with no history.
- On the `simulated` response, `tierTracks: TierTrack[]` and `hardware: HardwareStep[]` are added. The schema caps `hardware` at `TICKS_MAX` (5,000) and `tierTracks` at 1,000.
- `PlaygroundState.compile.tierTracks` and `compile.hardware` are reset wherever `markers` is reset.
- `HardwareFrame` gains `hw: HardwareStep | null`. It is `null` when `index >= hardware.length` (Review Focus 2).

- [ ] **Step 1: Failing tests:**
  - **tierTimeline:** on a fixture whose function tiers up (reuse the one `TieringModel.test.ts` uses), the track's segments start with `{ from: 0, tier: "ignition" }`, and a deopt appears at the tick of its `TierEvent`. `tierTimeline([])` is `[]`.
  - **cacheModel:** the first access to an address is `ram`, a repeat is `l1`; after 9 distinct lines, the first one is `l2`; after 41 it is `ram` again.
  - **classifyInstruction:** `push %rbp` is a `write` to the stack, `call Builtin::…` is a `fetch` from code, and `add` has `alu: "add"`.
  - **traceHardware:** on `nexttick-vs-promise`, `length === ticks.length`, and two runs are deep-equal (determinism).
  - **protocol:** `simulated` parses with both new arrays, and an oversized `hardware` array is rejected.
  - **useHardwareFrame (Review Focus 2):** at index 30 of a 40-tick job, swapping in a 3-tick job gives `frame.hw` for index ≤ 2 or `null`, and never throws.
- [ ] **Step 2:** `npx vitest run core/interpreter/tiering core/hardware features/playground/worker features/playground/store features/playground/hooks/useHardwareFrame` → FAIL.
- [ ] **Step 3:** Implement. Comments cite D2 and ADR-033/039 where the model is invented.
- [ ] **Step 4:** Rerun → PASS. `npx vitest run tests/conformance/tiering-isolation.test.ts tests/conformance/machine-state.test.ts` stays green, because the Exact layer is untouched.
- [ ] **Step 5:** Commit: `feat(core): tier timeline and illustrative hardware trace posted by the worker`.

**Done when:** these tests pass and the two isolation suites are unchanged.

---

### Task 4: Internals view-models (pure)
**Run with:** Sonnet, medium. **Review:** Sonnet, low.

**Files:**
- Create:
  - `features/v8-internals/model/transitionLayout.ts`
  - `features/v8-internals/model/latticeModel.ts`
  - `features/v8-internals/model/icRows.ts`
  - `features/v8-internals/model/heapStrip.ts`
  - `features/v8-internals/model/frameRows.ts`
  - one `*.test.ts` for each
  - `core/runtime/ic/verifiedSlotKinds.ts` (+test)

**Interfaces — Produces:**
- `transitionLayout(maps: readonly MapSnapshot[], focus?: MapId, cap = 128): { nodes: { id: MapId; x: number; y: number; label: string; dictionary: boolean; deprecated: boolean; current: boolean }[]; edges: { from: MapId; to: MapId; key: string }[]; hidden: number }`.
  - It builds a tidy tree from `backPointer`. Each edge `key` is the field the child added.
  - Over `cap`, it keeps the focus Map's ancestors and its nearest neighbors, and reports how many it left out in `hidden`.
  - Coordinates are integers in grid units, and the output is deterministic.
- `latticeModel(current: ElementsKind | null)` returns the 7 nodes in fixed positions, with the one-way edges `PACKED_SMI→PACKED_DOUBLE→PACKED`, `HOLEY_*` likewise, `PACKED_X→HOLEY_X`, and `*→DICTIONARY`. Each node carries `current: boolean` and `reachable: boolean` (reachable from the current kind).
- `VERIFIED_SLOT_KINDS: ReadonlySet<string>` is the slot kinds that `ic-states.cjs` asserts.
- `icRows(feedback: readonly FeedbackSnapshot[], limit = 50): { rows: { functionName; slot; kind; state; mapIds; truth: "verified-model" | "modeled" }[]; total: number }`.
- `heapStrip(heap: V8Snapshot["heap"], cells = 64): { young: { from: number; to: number }; old: number; lastGc: GcEvent | null }`. The counts are filled cells out of `cells` per region.
- `frameRows(frame: FrameSnapshot, opts: { predictFirst: boolean })` returns rows of `{ name: "acc" | \`r${n}\`; text; tag: "Smi" | "HeapObject" | "Oddball" | "internal"; tagged: string | null }`. Under `predictFirst`, strings become `"…"` and object previews `{…}` (D7).

- [ ] **Step 1: Failing tests:**
  - **transitionLayout:** on the hidden-classes example's last tick, `a` and `b`'s Maps both exist, and the `y`→`x` branch is a sibling of the `x`→`y` branch. With 300 synthetic Maps and a focus, `nodes.length ≤ 128`, `hidden === 300 - nodes.length`, and the focus Map's root path is intact (Review Focus 3).
  - **latticeModel:** from `PACKED_DOUBLE_ELEMENTS`, `PACKED_SMI_ELEMENTS` is not reachable and `HOLEY_DOUBLE_ELEMENTS` is.
  - **VERIFIED_SLOT_KINDS:** each kind appears in `ic-states.cjs`'s recorded `%DebugPrint` output.
  - **icRows:** 120 slots give 50 rows and `total: 120`.
  - **frameRows:** a Smi `5` shows `tagged: "0xa"` and the tag `Smi`; under `predictFirst`, a string shows `"…"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. Turn on Task 2's `it.todo` and run `example-internals.test.ts` → PASS.
- [ ] **Step 5:** Commit: `feat(v8-internals): pure view-models for maps, lattice, ICs, heap and frames`.

**Done when:** these tests and Task 2's view assertion pass.

---

### Task 5: Frame inspector, IC table and elements-kind lattice
**Run with:** Sonnet, high. **Review:** Sonnet, medium.

**Files:**
- Create:
  - `features/v8-internals/components/V8InternalsView.tsx` (the grid from the Task 1 brief)
  - `features/v8-internals/components/FrameInspector.tsx`
  - `features/v8-internals/components/IcTable.tsx`
  - `features/v8-internals/components/ElementsLattice.tsx`
  - `features/v8-internals/v8Internals.test.tsx`
- Modify:
  - `features/playground/store/playgroundStore.ts`: a `focusSlot: { functionId: FunctionId; slot: number } | null` field and a `focusFeedbackSlot(v)` action
  - `features/playground/components/panes/BytecodePane.tsx`: the `[n]` feedback operands become links that call `focusFeedbackSlot` and switch the bottom tab to `v8` (§8.3)

**Interfaces — Consumes:** `useV8State`, `useCallStack`, `useConsoleHidden` (predict-first), the Task 4 models and `TruthBadge`.

**Interfaces — Produces:**
- `FrameInspector`: the top frame's accumulator and registers as a `<table>` (mono, tabular numerals), with a Smi or HeapObject marker per row (text plus an icon). An Oddball shows its name. The badge is Verified model.
- `IcTable`: rows from `icRows`, each with a per-row badge and the Maps as `Map#n` chips.
  - The `focusSlot` row is highlighted and scrolled into view.
  - A "Show all N" button appears past 50 rows.
  - States use text labels (`monomorphic`, …), not color alone.
- `ElementsLattice`: the 7 nodes as an `<ol>` laid out in SVG.
  - The current kind is green with `aria-current="true"`.
  - Arrows are one-way, and unreachable kinds are dimmed with the text "(no way back)".
  - It shows the kind of the most recent array that changed. If no array exists, it shows a teaching empty state.

- [ ] **Step 1: Failing tests** (jsdom, `fixtureRun`):
  - On `elements-kinds-lattice`, at the tick of each `console.log(list…)`, the lattice's `aria-current` node text equals that probe's recorded kind (from Task 2's helper).
  - **Review Focus 5:** in interview mode before reveal, the frame inspector on the tick before `console.log("sync 1")` (`nexttick-vs-promise`) has no text `sync 1`. After `reveal()` it does.
  - Clicking a `[0]` operand in the bytecode pane sets `focusSlot` and marks that IC row `aria-selected="true"`.
  - Each panel's badge `aria-label` contains its `TRUTH_TOOLTIPS` sentence.
- [ ] **Step 2:** Run `npx vitest run features/v8-internals features/playground/components/panes` → FAIL. **Step 3:** Implement. **Step 4:** Rerun → PASS.
- [ ] **Step 5:** Commit: `feat(v8-internals): frame inspector, IC table and elements-kind lattice`.

**Done when:** these tests pass.

---

### Task 6: Hidden-class graph, heap strip and tier timeline
**Run with:** Sonnet, high. **Review:** Sonnet, medium.

**Files:**
- Create:
  - `features/v8-internals/components/HiddenClassGraph.tsx`
  - `features/v8-internals/components/HeapStrip.tsx`
  - `features/v8-internals/components/TierTimeline.tsx`
- Modify: `features/v8-internals/v8Internals.test.tsx`

**Interfaces — Consumes:** `transitionLayout`, `heapStrip`, `compile.tierTracks`, `playback.index` and `v8.changedMapId`.

**Interfaces — Produces:**
- `HiddenClassGraph`: an SVG tree of `Map#n` nodes.
  - Edges are labelled with the added key.
  - The current Map (`changedMapId`, or the accumulator's object Map) is green.
  - Dictionary Maps have a dashed border and the label "dictionary". Deprecated Maps are struck through with the label "deprecated".
  - A "Table" toggle renders the same nodes as a `<table>` (the text alternative).
  - A new node fades in through Motion (`opacity` and `transform`, 220 ms).
  - "+N more Maps" appears when `hidden > 0`.
- `HeapStrip`: young (the from and to semi-spaces) and old, as cell rows.
  - On a tick whose `lastGc` is new, a scavenge shows surviving cells moving to-space or old ("promoted") with a 220 ms Motion transform, which is instant under reduced motion.
  - The badge is Illustrative, plus a caption: "Sizes are estimates; GC never changes your program's output."
- `TierTimeline`: one row per `TierTrack`, with segments laid along the tick axis (Ignition → Sparkplug → Maglev → TurboFan) and red deopt markers whose tooltip is `DEOPTIMIZE_REASON_MESSAGES[reason]`.
  - A vertical line marks the current index.
  - The header reads "V8 would typically tier up here", with the Modeled badge.
  - With no tracks, it explains that the function never got hot.
  - A "Show all N" button appears past 50 rows.

- [ ] **Step 1: Failing tests:**
  - On `hidden-classes-shapes`, at the last probe, the graph contains a node for both Maps of `a` and `b` (or one shared node when the twin says `true`), and the table view lists the same `Map#` ids.
  - On a GC fixture (the one `gc-fixtures.test.ts` uses) at the tick after a scavenge, the strip shows a "scavenge" label.
  - Given 80 tracks, the tier timeline renders 50 rows and "Show all 80".
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with the `motion-design` skill. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(v8-internals): hidden-class graph, heap strip and tier timeline`.

**Done when:** these tests pass, and `tests/tooling/no-ssr-style.test.tsx` still passes.

---

### Task 7: R3F foundation (lazy canvas, WebGL detection, CSP and build spike)
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create:
  - `features/hardware-3d/HardwareView.tsx`
  - `features/hardware-3d/webgl.ts`
  - `features/hardware-3d/useHwViewMode.ts`
  - `features/hardware-3d/perf/PerfOverlay.tsx`
  - `features/hardware-3d/hardware.test.tsx`
- Modify:
  - `package.json`: add `r3f-perf`, pinning an exact version at least two weeks old
  - `features/playground/components/lazy.ts`: add `HardwareViewLazy` and `V8InternalsViewLazy`

**Interfaces — Produces:**
- `hasWebGL(): boolean` tries `webgl2`, then `webgl`, on a detached canvas, inside `try`/`catch`.
- `type HardwareViewMode = "3d" | "2d"`.
- `useHwViewMode(): { mode; reason: "user" | "no-webgl" | "context-lost" | "narrow" | null; setMode(m) }`. The default comes from D5 as the owner confirmed it in Task 1.
- `HardwareView`: renders `HardwareCanvas` (Task 8) or `SvgBoard` (Task 9) behind its own `next/dynamic`, so the SVG path never loads `three`.
  - It has a 3D/2D toggle (`aria-pressed`) and a notice when `reason` is not `user`.
  - On `webglcontextlost` it switches to 2D with `reason: "context-lost"` (Review Focus 1).
- `PerfOverlay` mounts `r3f-perf` only when `useSearchParams().get("perf") === "1"`, through `next/dynamic`.

- [ ] **Step 1: Spike** under `npm run build && npm run start`. Mount a bare `<Canvas>` with one mesh, `AdaptiveDpr` and `PerformanceMonitor`, plus `?perf=1`. With Playwright, collect the `Content Security Policy` console messages and the `pageerror`s. Then run `scripts/check-build.mts`, which the build already runs, and confirm that no `eval`, `new Function` or `child_process` came in through `three`, drei or `r3f-perf`.
  - Fix each finding with the narrowest change.
  - If `r3f-perf` injects a `<style>` without a nonce, or needs eval, **stop and report**. D6 falls back to `PerformanceMonitor` plus a `requestAnimationFrame` sampler, recorded as an ADR.
  - Record the exported fps accessor that the e2e reads (Task 11).
- [ ] **Step 2: Failing tests** (jsdom):
  - when `hasWebGL` is mocked `false`, the view renders the SVG path and the notice "3D unavailable; showing the 2D board"
  - dispatching `webglcontextlost` on the canvas element switches to 2D
  - when `localStorage` throws, the toggle still works for the session
- [ ] **Step 3:** Implement. **Step 4:** `npx vitest run features/hardware-3d` → PASS. Then `npm run build`: record the `/playground` first-load JS, which must equal ADR-062's number within 0.5 KB, and name the lazy chunk that holds `three`.
- [ ] **Step 5:** Commit: `feat(hardware-3d): lazy R3F canvas with WebGL detection and SVG fallback switch`.

**Done when:** the spike report lists no CSP or build finding (or each one fixed), the tests pass, and the bundle is unchanged.

---

### Task 8: 3D board scene
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create:
  - `features/hardware-3d/board/HardwareCanvas.tsx`
  - `features/hardware-3d/board/CpuDie.tsx`
  - `features/hardware-3d/board/RegisterBank.tsx`
  - `features/hardware-3d/board/Alu.tsx`
  - `features/hardware-3d/board/Caches.tsx`
  - `features/hardware-3d/board/Ram.tsx`
  - `features/hardware-3d/board/Buses.tsx`
  - `features/hardware-3d/board/labels.ts` (CanvasTexture sprites)
  - `features/hardware-3d/board/boardResources.ts`
  - `features/hardware-3d/board/boardColors.ts`
  - `features/hardware-3d/boardResources.test.ts`
- Modify: `features/hardware-3d/hardware.test.tsx`

**Interfaces — Consumes:** `useHardwareFrame(onFrame)` → `{ tick, machine, hw }`, `RegisterRoles` and `TruthBadge`.

**Interfaces — Produces:**
- `HardwareCanvas`:
  - `<Canvas frameloop={…}>` per D4, with `dpr={[1, 2]}`, `AdaptiveDpr` and `PerformanceMonitor` (which lowers the DPR on decline)
  - `role="img"`, with an `aria-label` set through a ref to `"<asm text>; rax=<hex>, rsi=<hex>"` (both AT&T and Intel follow the pane's syntax)
- **The register bank** labels each register with its V8 role from `RegisterRoles` (`rax = accumulator`, `rsi = context`, `rbp`, `rsp`, `r13 = root register`, …), citing `REGISTER_HEADER_SOURCE` in a one-line comment. A register whose value changed flashes for 150 ms.
- **The ALU** shows `hw.alu` as its op label, lit while it is non-null.
- **The caches:** L1 has 8 cells and L2 has 32, drawn from `hw.l1`/`hw.l2`. The served cell flashes green ("hit") or, on a miss, red ("miss") and a RAM cell lights up.
- **RAM:** one `InstancedMesh` of 3 × 64 cells (stack / young / old). The fill comes from the call-stack depth and `heapStrip`, through `setColorAt`, with `instanceColor.needsUpdate` set only when a value changed.
- **Buses:** a pulse along the bus to `hw.bus.region`, colored by `fetch`/`read`/`write` (a token color, plus a text legend).
- `boardResources`: `acquire(key, create)` and `release(key)`, a ref-counted registry of shared geometries and materials; the last release calls `dispose()`.
- `boardColors()` reads the CSS tokens through `getComputedStyle(document.documentElement)` and re-reads them on a theme change (a `MutationObserver` on `html.class`).
- **The rules:**
  - no `setState` in `useFrame`
  - mutations are scaled by `delta`
  - **no component under the canvas subscribes to the store**

- [ ] **Step 1: Failing tests:**
  - **boardResources (Node, Review Focus 4):** two acquires and one release do not dispose. The second release calls `dispose` once. Acquiring again after that creates a fresh object.
  - **Zero renders (jsdom):** mount `HardwareView` in 3D mode with `@react-three/fiber`'s test renderer (or with the canvas mocked to render the scene children), wrapped in a React `<Profiler>`. After the mount settles, 50 `seek` calls produce **0** commits.
  - **Review Focus 2:** swapping to a 3-tick job at index 30 keeps the scene mounted and makes the next frame read `hw === null` or an index ≤ 2.
- [ ] **Step 2:** Run `npx vitest run features/hardware-3d` → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Manual check in `next dev` with `?perf=1` (the `webapp-testing` skill): play "recursive factorial" at 2×. Put a screenshot with the Perf panel in the report. Commit: `feat(hardware-3d): R3F board driven by refs with illustrative caches and buses`.

**Done when:** these tests pass, and the manual check shows the board animating with no console errors.

---

### Task 9: SVG fallback board
**Run with:** Sonnet, medium. **Review:** Sonnet, low.

**Files:**
- Create: `features/hardware-3d/svg/SvgBoard.tsx`
- Modify: `features/hardware-3d/hardware.test.tsx`

**Interfaces — Produces:** `SvgBoard` has the same regions and labels as the 3D board, in a flat SVG.
- It subscribes through `useHardwareFrame(onFrame)` and updates `fill`, `textContent` and `class` through element refs, so it makes **no React commits per tick**.
- It uses CSS classes from tokens: no inline `style`, and no SSR, because it is lazy.
- The badge is Illustrative.
- The visible register values are text with tabular numerals, so screen readers get them without the canvas label.

- [ ] **Step 1: Failing tests:**
  - with WebGL mocked off, the SVG shows the text `rax` and `accumulator`
  - after `seek(n)`, the `rax` value text equals `machine.registers.rax` as hex
  - 50 seeks produce 0 commits under `<Profiler>`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(hardware-3d): SVG fallback board`.

**Done when:** these tests pass.

---

### Task 10: Bottom panel wiring and the mobile pass (ADR-060)
**Run with:** Sonnet, medium. **Review:** Sonnet, low.

**Files:**
- Modify:
  - `features/playground/components/bottom/BottomPanel.tsx`: the `v8` tab gets `V8InternalsViewLazy`, and the `hardware` tab gets `HardwareViewLazy`
  - `features/playground/components/playback/PlaybackBar.tsx`: the ADR-060 popover
  - `features/playground/components/palette/CommandPalette.tsx`: "Toggle 3D" also flips `useHwViewMode` when the Hardware tab is already open
- Delete: `features/playground/components/bottom/PlaceholderPanel.tsx`
- Create, only if the popover needs it: `components/ui/popover.tsx` via `npx shadcn@latest add popover`

**Interfaces — Produces:**
- The Hardware tab is visible at every width. Under 768 px it opens on the SVG board (D5).
- At 375 px, First, Last and speed move into a "More playback" popover, as the Phase 6 brief specified. The popover chunk is lazy, so first-load JS is unchanged. Close ADR-060 with a new ADR.

- [ ] **Step 1: Failing tests:**
  - the `v8` tab no longer renders the placeholder text, and the `hardware` tab renders `HardwareView`
  - at 375 px (a `matchMedia` mock), the "More playback" button exists, and opening it shows First, Last and the speed group, each reachable with Tab
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. `npm run build`: first-load JS is unchanged (record it).
- [ ] **Step 5:** Commit: `feat(playground): wire internals and hardware tabs; mobile playback popover`.

**Done when:** these tests pass and the bundle is unchanged.

---

### Task 11: Done-when e2e and the performance measurement
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create:
  - `e2e/playground-internals.spec.ts`
  - `e2e/hardware-fallback.spec.ts` (a Playwright project with `launchOptions.args: ["--disable-webgl", "--disable-3d-apis"]`)
  - `e2e/hardware-perf.spec.ts` (skipped unless `PERF=1`)
- Modify:
  - `playwright.config.ts`: the `no-webgl` project
  - `e2e/helpers/playground.ts`: an `openBottomTab(name)` helper

**Every spec:** after it ends, the collected CSP messages and `pageerror`s are `[]` (the Phase 6 helper).

- [ ] **Step 1: Write the specs** against `npm run e2e` (the production server):
  - **Hidden classes.**
    - Load "hidden classes: same shape vs different order", open V8 Internals, and seek to each `console.log` line's tick.
    - The graph's current-Map labels for `a`/`b` are equal **iff** the twin's recorded probe is `true`. Read the probes from the twin's `*.expected.json`; never hard-code them.
  - **Elements kinds.** Load "elements kinds: SMI → DOUBLE → HOLEY". At each probe tick, the lattice node with `aria-current="true"` reads the recorded kind.
  - **No renders per tick.** The proof is the `<Profiler>` tests from Tasks 8 and 9 (0 commits over 50 seeks), with no test hook in the app. Here, play the board at 8× to the end in both modes and assert that no `longtask` entry exceeds 50 ms (`PerformanceObserver({ type: "longtask" })`).
  - **Fallback.** In the `no-webgl` project, open Hardware: the SVG board is visible with `rax` and `accumulator`, the notice is shown, there is no `<canvas>`, and the console has no errors.
  - **axe.** The V8 Internals and Hardware tabs (SVG mode) pass axe at 1280 px.
  - **Perf (`PERF=1`, headed, real GPU).** Open `/playground?perf=1` with "recursive factorial", open Hardware (3D), play at 2× for 10 s, then read the average fps through the accessor recorded in Task 7. Assert `≥ 55`.
- [ ] **Step 2:** Run `npm run e2e -- playground-internals hardware-fallback` → PASS. Run `PERF=1 npm run e2e -- hardware-perf --headed` once on this machine and put the measured fps (average, min, and the GPU name) in the report. If it is below 55, stop and dispatch Opus, high with `superpowers:systematic-debugging` before Task 12.
- [ ] **Step 3:** Commit: `test(e2e): internals transitions, hardware fallback, render isolation and 3D fps`.

**Done when:** these specs pass, and the report holds the fps measurement.

---

### Task 12: impeccable critique, audit and detect, then the fix batch
**Run with:** Opus, medium. **Review:** Sonnet, medium.

- [ ] **Step 1:** Run `impeccable critique` and `impeccable audit` on the V8 Internals and Hardware tabs, at 375, 768, 1280 and 1440 px, in both themes and under reduced motion. Then run `impeccable detect --json <changed files>`.
- [ ] **Step 2:** Fix the agreed findings **in one batch**. Justify each remaining `detect` finding in the report. Re-run only the test files the fixes touched.
- [ ] **Step 3:** Commit: `fix(ui): internals and hardware critique and audit batch`.

**Done when:** `detect` is clean or justified, and screenshots at the 4 widths are in the report.

---

### Task 13: Docs
**Run with:** Sonnet, low. **Review:** Haiku, low.

- [ ] Write ADR-063 onward in `docs/DECISIONS.md`: D1 to D7, plus each deviation found in Tasks 7–11 (closing ADR-060). Keep each one short, in the existing Context / Decision / Consequence style.
- [ ] Update `docs/FIDELITY.md`:
  - the IC table's per-row truth rule
  - the Illustrative cache, bus and ALU model (D2)
  - the natives-twin proof (D3)
- [ ] Update `docs/ARCHITECTURE.md` with the worker's `tierTracks` and `hardware`.
- [ ] Update `DESIGN.md` through `impeccable document` (the new panels, the board colors).
- [ ] Update `PROMPT.md`'s status line: Phase 7 implemented, its plan and its ADR range.
- [ ] Commit: `docs: phase 7 decisions, fidelity and design`.

**Done when:** the docs name every new ADR, and `npm run docs:subset` shows no drift.

---

### Task 14: Full verification run
**Run with:** Haiku, low. **Review:** none.

- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run conformance` and `npm run e2e`, and paste the tail of each output into the report.
- [ ] Record `/playground` first-load JS (the ADR-062 method) and the lazy chunk sizes for `three` and the internals view.

**Done when:** all six commands pass, with their output shown. On a failure, stop and dispatch Opus, high (debugging); do not edit anything in this task.

---

### Task 15: Final bug and security review
**Run with:** Opus, medium. **Review:** none.

- [ ] Review `git diff phase-6...phase-7` for bugs and security. Focus on:
  - CSP and injected styles from the 3D stack
  - user-controlled text reaching the canvas labels or SVG (it must stay text)
  - unbounded arrays on the worker protocol
  - GPU resource leaks
  - the predict-first leak
  - stale reads across jobs
- [ ] Write the findings as a ranked list, each with a file:line and a concrete failure scenario. Do not fix anything in this task.

**Done when:** the findings list is in the report.

---

### Task 16: Fix agreed findings, re-verify and report
**Run with:** Sonnet, medium. **Review:** Haiku, low.

- [ ] Fix the findings the owner agrees with, one commit each (`fix(<scope>): …`). Note the ones rejected, with the reason.
- [ ] Re-run only the affected test files, then `npm run lint && npm run typecheck && npm run build`.
- [ ] Write the phase report:
  - what was built
  - the verification output
  - the fps measurement
  - deviations (ADR-063+)
  - fidelity gaps
  - open risks

  **Then stop for review.**

**Done when:** the report is delivered and the tree is clean.

---

## Open risks / follow-ups

- **A twin probe may disagree with our model,** for example over in-object slack or Map deprecation. That is a model bug in `core/runtime/objects`, and it gets fixed there (Task 2 escalation), never by changing the twin.
- **`r3f-perf` may fail CSP in production** (Task 7 spike). The fallback measurement is `PerformanceMonitor` plus an rAF sampler, recorded as an ADR.
- **Headless fps is meaningless.** The 60 fps proof is a headed run on one machine, so CI enforcement waits for Phase 9's performance work.
- **The cache model is invented** (D2). It must never be described as V8's or the CPU's real behavior. The badge and the FIDELITY row say so.
