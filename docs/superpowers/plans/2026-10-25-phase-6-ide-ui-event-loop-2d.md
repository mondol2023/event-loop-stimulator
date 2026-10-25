# Phase 6: IDE UI and the 2D Event Loop (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 5 smoke shell with the real `/playground` IDE: the editor, four synchronized code panes, examples with verified badges, diagnostics, a playback bar with phase and fidelity markers, narration, the 2D event loop, a command palette, onboarding, usage modes and reduced-motion support. All of it is CSP-clean under `next start`.

**Architecture:** The UI only renders. Every read goes through Phase 5's selector hooks, and every write through the store's actions. The parts are:
- `features/playground/`: the shell, the code panes (CodeMirror 6, read-only except the editor), the playback bar, the examples, the palette and onboarding.
- `features/event-loop-2d/`: the 2D view (Motion).
- `features/preferences/`: theme and usage mode, stored in cookies so the server renders the right theme with no flash.

Three small changes reach below the UI. `core/timeline/boundaries.ts` gains `timelineMarkers`, which the worker posts. `AsmLine` gains its Intel text. A generated example catalog ties each example to its recorded fixture.

**Tech Stack:** Next.js 16.3.8, React 19.2.8, Tailwind v4 tokens (`app/globals.css`), shadcn (radix-nova) on `radix-ui`, CodeMirror 6 (`@uiw/react-codemirror`, `@codemirror/{view,state,lint,lang-javascript}`), Motion 14 (`motion/react`), Lucide, `cmdk` (new, via shadcn `command`), Zustand 5, Vitest 5 + jsdom + Testing Library, Playwright + `@axe-core/playwright`.

**Spec:** `PROMPT.md` §8 (all of it), §9 Phase 6, §2 principles 3, 9 and 10, §3.1 ("teach the boundary") and §3.4 item 5 (badges). `PRODUCT.md` (modes, voice, accessibility). ADR-003, ADR-005, ADR-012, ADR-040 to ADR-047 constrain it and **win where they conflict**. Before Task 2, read `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` and `01-app/03-api-reference/04-functions/headers.md`.

## Context

- Phase 5 is done on `phase-5n`. Its HEAD is `7e558ed` ("fwfjwlf", a docs and nondeterminism follow-up whose message is not Conventional; leave it as it is). The working tree is clean.
- **Phase 5 contracts this phase consumes and must not break:**
  - the store (`features/playground/store/playgroundStore.ts`) and its actions
  - the hooks `useCallStack`, `useQueues`, `useLoopPhase`, `useConsole`, `useV8State`, `useNarration`, `useFidelityWarnings`, `useHighlightedLines(pane)` and `useHardwareFrame`
  - `useShortcuts` and its ADR-047 rules
  - `PlaygroundProvider`
- `PipelineSmoke.tsx` is deleted in Task 8. `e2e/playground-worker.spec.ts` and `e2e/playground.spec.ts` move to the new UI's labels in the same task.

**Done when (PROMPT §9 Phase 6):**
- `impeccable critique` and `audit` findings are fixed in one batch.
- `impeccable detect` is clean, or every remaining finding is justified.
- The surface is checked at 375, 768, 1280 and 1440 px.
- `DESIGN.md` is written.
- A Playwright run:
  - steps through "nextTick vs Promise", asserting the queue contents and that the console order equals the recorded real-Node output
  - hovers a bytecode line and confirms the source, AST and asm highlights
  - shows the nondeterminism warning on the setImmediate example
  - passes axe
  - shows no CLS during playback
  - produces no CSP violations in the console

## Verified facts (probed 2026-10-25 in this repo; do not re-derive)

- **"nextTick vs Promise" timeline.** `simulate` gives 40 ticks, and `jobBoundaries` gives `[0, 7, 21, 34, 39]`.
  - At tick 7 (`phase: "nextTick"`), the nextTick queue holds 2 entries labelled `process.nextTick((anonymous))`, and the microtask queue holds 2 labelled `then((anonymous))`.
  - Tick 39 is `exit`.
  - The recorded stdout is `sync 1\nsync 2\ntick 1\ntick 2\ntick scheduled from a tick\npromise 1\npromise 3\npromise scheduled from a tick\npromise 2\ntick scheduled from a promise job\n`.
- **The setImmediate fixture** (`timeout-vs-immediate-main`) is recorded with `nondeterministic: true` and two outcomes.
- **Example fixtures that already exist** (`tests/conformance/fixtures/`):

  | Example | Fixture |
  |---|---|
  | Promise vs setTimeout | `promise-vs-timeout` |
  | nextTick vs Promise | `nexttick-vs-promise` |
  | async/await ordering | `async-await-order` |
  | await a thenable | `await-thenable-two-extra-ticks` |
  | setTimeout 0 vs setImmediate | `timeout-vs-immediate-main` |
  | closure context | `closure-counter` |
  | recursive factorial | `recursion-factorial` |
  | uncaught TypeError | `uncaught-type-error` |

  The **hidden-classes** and **elements-kinds** probes live in `tests/conformance/internals/` and use `%` natives, which user programs refuse. They need natives-free fixtures (Task 4).
- **The local runtime is Node 24.22.1, but the target is 24.19.0,** so `npm run conformance:record` refuses here. Recording needs the pinned runtime, e.g. `npx -y node@24.19.0 --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/conformance/record.mts <fixture>` (Task 4 verifies the exact invocation).
- **Views.**
  - `AsmLine` carries only AT&T `text`. `core/baseline/x64/syntax.ts` has `formatInstruction(ins, "intel")`.
  - `AstLine` has `depth` and `range`. `BytecodeLine` has `offset` and `sourcePosition`. `BinaryLine` has `bytes`.
  - `Diagnostic.docs` is the repo path `"docs/SUPPORTED_SUBSET.md"`, not a URL.
- **Packages.**
  - Installed: `@codemirror/{lint,view,state,language,search,commands,autocomplete,lang-javascript,theme-one-dark}`, `style-mod`, `radix-ui`, `motion`, `@axe-core/playwright`.
  - Not installed: `cmdk` and `react-resizable-panels`.
  - `components/ui/` has only `button.tsx`.
- **CSP** (ADR-012): production `style-src 'self' 'nonce-…'`. `proxy.ts` forwards the nonce on the `x-nonce` request header.
  - An SSR `style="…"` attribute violates the CSP.
  - A `<style>` element without the nonce violates it too. CodeMirror injects these through `style-mod` unless `EditorView.cspNonce` is set.
  - Styles set from JavaScript through the CSSOM (`el.style.x = …`, which is what React and Motion do on the client) are allowed.
- **Bundle.** First-load JS for `/playground` was about 232 KB gz at the end of Phase 5, against a budget of 250 KB (ADR-040). CodeMirror and Motion must therefore load lazily.

## Decisions (become ADR-048+, flagged for owner review)

- **D1: No SSR `style=`, a nonce for every injected `<style>`.**
  - The page reads `x-nonce` from `headers()` and passes it down as a prop.
  - CodeMirror instances get `EditorView.cspNonce.of(nonce)`.
  - Components that style inline (Motion, the resizable split, the scrubber thumb) render their styled nodes only on the client: they mount after hydration, or set styles through refs.
  - `tests/tooling/no-ssr-style.test.tsx` renders the server shell and fails on any ` style="`.
- **D2: The example catalog is generated from the recorded fixtures.**
  - `npm run examples:sync` writes `features/playground/examples/catalog.generated.ts` from a hand-written list (`examples.config.ts`: id, title, fixture name, teaching blurb) plus each fixture's source and `*.expected.json` (target and nondeterministic flag).
  - `tests/conformance/examples.test.ts` regenerates the catalog in memory and fails on drift. It also fails when the simulator's stdout differs from any recorded outcome.
  - `features/` never imports `tests/`.
  - The "Matches Node vX (V8 Y)" badge shows only when the editor text equals an example's source byte for byte. Otherwise the editor shows "Simulated by spec model".
- **D3: What each usage mode changes** (ADR-005; the owner confirms in Task 1). The proposal:

  | Mode | Theme | Type scale | Default speed | Density | Output |
  |---|---|---|---|---|---|
  | Self-study | user's | 1× | 1× | dense | shown live |
  | Interview prep | user's | 1× | 2× | dense | **predict first**: the console shows "Predict the output, then reveal" until Reveal or the last tick |
  | Classroom | light (overridable) | 1.125× root | 0.5× | roomy | shown live |

  - The mode and theme are cookies (`sl_mode`, `sl_theme`; `SameSite=Lax`, one year, not HttpOnly), read by `app/layout.tsx`, so the first paint is already right.
  - The values are validated with Zod, and an invalid value falls back to the default.
- **D4: The worker posts timeline markers.**
  - `timelineMarkers(ticks)` (in core) returns one marker per job boundary, `{ index, phase, loopPhase }`, plus one per tick where a fidelity warning first appears, `{ index, kind: "warning", message }`.
  - The `simulated` response gains `markers`.
  - The main thread never scans the timeline to draw the scrubber.
- **D5: The asm view carries both syntaxes.** `AsmLine` gains `intel: string`, so the AT&T/Intel toggle is a client choice and the bytes cannot change with it.
- **D6: Every code pane is CodeMirror 6 (§5), read-only except the editor,** and loads through `next/dynamic(…, { ssr: false })` behind a skeleton of fixed height (no CLS).
  - A single `highlightField` (a `StateField` of line decorations) applies `useHighlightedLines(pane)`: `cm-sl-current` for the solid highlight and `cm-sl-hovered` for the outline.
  - Each decorated line also carries the attribute `data-sl-highlight="current|hovered"` for e2e.
- **D7: Diagnostics link to an in-app `/docs/subset` page** (Read mode).
  - It renders the excluded-construct table from `core/frontend/subset/excluded.ts`, the same source as `npm run docs:subset`.
  - Each row has an anchor id. `Diagnostic.docs` (`docs/SUPPORTED_SUBSET.md`) maps to `/docs/subset#<code>` in one function.
- **D8: Resizable panes come from a small in-house `ResizableSplit`** that sets sizes through refs (CSSOM), unless Task 2's spike shows that shadcn `Resizable` (`react-resizable-panels`) emits no SSR `style=`. If it is clean, use shadcn.

## Global Constraints

- **Never execute user code.** No blob or data-URL scripts, no `eval`, no `new Function`, no `dangerouslySetInnerHTML` of user text. Source and console text render as text nodes or through CodeMirror documents, never as HTML.
- **CSP.** Production keeps `style-src 'self' 'nonce-…'` and never gains `'unsafe-inline'` or `'unsafe-eval'`. There is no SSR `style=` attribute (D1).
- **Layers.** `features/` imports `core/`, `components/` and `lib/` only. `app/` composes it. Nothing here touches `server/` except reading `headers()`/`cookies()` in `app/`. `core/` additions stay pure and come with Node-environment tests.
- **Reads and writes.** Components read through the Phase 5 hooks or `useStore(store, selector)` with a primitive or shallow selector. They write only through store actions. No component holds a `TimelineStore`.
- **Per-frame work** never re-renders components that did not subscribe to the changed slice (principle 9). Motion animates only `transform` and `opacity`.
- **Styling.** Semantic tokens only (`bg-panel`, `text-microtask`, `text-warning`, `text-macrotask`, `text-webapi`, `text-destructive`, `text-current`), never raw hex. Any new token is added to both themes and to `tests/tooling/contrast.test.ts` at 4.5:1 or better.
- **Color roles** (§8.1):

  | Role | Color |
  |---|---|
  | Primary action / current tick | green |
  | Microtask (V8) | violet |
  | nextTick (Node) | violet outline + a "nextTick" label |
  | Timers / immediates | amber + phase labels |
  | Host APIs (libuv) | cyan |
  | Error | red |
  | Fidelity warning | yellow |

  Color is always paired with a label or an icon.
- **Type.** IBM Plex Sans for UI. JetBrains Mono with tabular numerals only for code, bytecode, asm, hex, registers and addresses.
- **Icons.** Lucide only, no emoji. Icon-only buttons have an `aria-label` and a tooltip.
- **Motion.**
  - Transitions take 150–250 ms, with `--duration-enter: 220ms` and `--duration-exit: 150ms`, and exits are faster than entrances.
  - Stack frames use `spring { stiffness: 500, damping: 32 }` (no overshoot), enter with that spring and leave with a fade-up exit inside `AnimatePresence mode="popLayout"`.
  - Tasks share a `layoutId` (`task-<TaskRef.id>`).
  - `MotionConfig reducedMotion="user"`, so changes are instant under `prefers-reduced-motion`.
  - Rejected: GSAP, `back.out` overshoot and orchestrated page-load sequences.
- **States.** Every interactive component has default, hover, focus-visible, active, disabled, loading and error states. Loading uses skeletons, never centered spinners. Touch targets are at least 44×44 px, with 8 px or more between them.
- **Truth badges** (§3.2): quiet, with an icon and a tooltip, using the exact `TRUTH_TOOLTIPS` text from `core/shared/fidelity.ts`.

  | Badge | Icon |
  |---|---|
  | Exact | `Check` |
  | Verified model | `FlaskConical` |
  | Modeled | `Gauge`, dashed outline |
  | Illustrative | `PencilLine` |

- **Voice** (PRODUCT.md): a friendly coach that stays technically exact. Errors say what happened and what to try. The UI says that the event loop is **Node/libuv**'s and the microtask queue is **V8**'s.
- **Accessibility.**
  - WCAG 2.2 AA, every control reachable by keyboard, visible focus.
  - Narration in an `aria-live="polite"` region.
  - The axe pass is clean.
- **TypeScript.** Strict flags, no `any`, exhaustive `switch` with `never` on panes, phases, modes and truth levels.
- **Comments and tests.** Comments are one line and give the *why* or the ADR they rely on. Tests prove only a done-when item or a Review Focus risk: no snapshot tests and no tests of trivial setters.
- **Commits.** Commit per task with Conventional Commits, ending with the `Co-Authored-By` trailer from the session's attribution reminder.

## Review Focus

1. **A CSP violation that only production shows.** An SSR `style=` from a Radix, Motion or resizable component, or a CodeMirror `<style>` without the nonce, appears only under `next start` → Task 2 (the guard test and a spike under `next start`) and Task 13 (e2e on every interaction that mounts new UI: the palette, a tooltip, onboarding, the 2D view and a theme switch).
2. **A highlight or hover that outlives its program.** The learner hovers line 30, then a shorter program's `compiled` arrives. A decoration past `doc.lines` would throw a `RangeError` in CodeMirror, and the old hover must not outline unrelated lines → Task 7 (decorations clamp to the document and drop out-of-range lines; a test swaps in a 3-line document while line 30 is highlighted).
3. **The shortcuts fight focused widgets.** `←`/`→` on the focused scrubber (a `role="slider"`), `Space` on a toolbar button, typing in the palette input or the editor. Each key must act exactly once, by its owner → Task 9 (with the scrubber focused, one `ArrowRight` moves the index by exactly 1, not 2; `Space` on the Play button toggles once).
4. **A big program.** 400 lines and about 80 functions give thousands of asm lines, and 100 or more pending timers. CodeMirror virtualizes long documents, but a React list of queue items does not → Task 10 (a queue region renders at most 12 items plus a "+N more" chip; a test feeds 200).
5. **Picking an example over the learner's own edits** silently destroys their work → Task 8 (when the editor text is non-empty and matches no example, choosing an example opens an `AlertDialog` naming it: "Replace your code with 'nextTick vs Promise'?"; Cancel keeps the text).

---

## File Structure

```
core/timeline/boundaries.ts (+test)            timelineMarkers (D4)
core/views/AsmView.ts (+test)                  AsmLine.intel (D5)
features/playground/worker/{protocol,handleRequest}.ts    markers on `simulated`
features/playground/store/playgroundStore.ts   compile.markers; setLang/setSource unchanged
features/playground/examples/{examples.config.ts,catalog.generated.ts,useActiveExample.ts}
scripts/examples-sync.mts                      writes catalog.generated.ts (D2)
tests/conformance/examples.test.ts             drift + stdout guard (D2)
tests/conformance/fixtures/{hidden-classes-shapes,elements-kinds-lattice}.cjs (+expected, recorded)
features/preferences/{prefs.ts,PreferencesProvider.tsx,usePreferences.ts} (+test)   D3
components/ui/{tooltip,tabs,toggle-group,dialog,alert-dialog,command,skeleton,kbd,badge}.tsx  shadcn
features/playground/components/
  PlaygroundShell.tsx          the three regions + narrow-screen segmented control
  ResizableSplit.tsx           D8 (unless shadcn Resizable passes the spike)
  TruthBadge.tsx               §3.2 badge
  editor/{SourceEditor.tsx,diagnosticsExtension.ts,ProblemsList.tsx,LangToggle.tsx}
  panes/{CodePane.tsx,highlightField.ts,AstPane.tsx,BytecodePane.tsx,MachineCodePane.tsx,paneDocs.ts}
  examples/{ExamplesMenu.tsx,VerifiedBadge.tsx}
  playback/{PlaybackBar.tsx,Scrubber.tsx,NarrationLine.tsx,StopNotice.tsx}
  palette/CommandPalette.tsx
  onboarding/CoachMarks.tsx
  bottom/{BottomPanel.tsx,PlaceholderPanel.tsx}
features/event-loop-2d/{EventLoopView.tsx,CallStackRegion.tsx,QueueRegion.tsx,HostApisRegion.tsx,PhaseRing.tsx,ConsolePanel.tsx,TaskChip.tsx} (+tests)
app/playground/page.tsx (modify)   app/layout.tsx (modify: prefs cookies)   app/docs/subset/page.tsx (new)
tests/tooling/no-ssr-style.test.tsx
e2e/{playground-ide.spec.ts,playground-a11y.spec.ts,playground-responsive.spec.ts} (+ updated playground*.spec.ts)
DESIGN.md   docs/{DECISIONS,ARCHITECTURE,FIDELITY}.md   PROMPT.md status   CLAUDE.md (examples:sync row)
```

## Model and effort per task

The main session is the **orchestrator**. It dispatches each task to a fresh subagent and passes the `model` and `effort` below **explicitly**; a task never runs on the main session's model by default. After each task, a review subagent runs with the **Review** model. If the review finds problems, the same implementer model fixes them once. A task that fails twice escalates to **Opus, high**. Any conformance mismatch: stop and dispatch **Opus, high** with `superpowers:systematic-debugging`.

| # | Task | Run with | Review with | Why |
|---|---|---|---|---|
| 0 | Branch + plan commit | Haiku, low | none | Git only |
| 1 | `impeccable shape` + owner decisions | **Opus, medium** | none (the owner reviews) | Design direction and D3 need judgement and the owner |
| 2 | CSP styling spike + no-SSR-style guard | **Sonnet, high** | **Opus, medium** | Production-only failure mode; it sets D1 and D8 |
| 3 | Core + protocol: markers, Intel asm | Sonnet, medium | Sonnet, low | Small pure additions |
| 4 | Example catalog + two new fixtures | **Sonnet, high** | **Opus, medium** | Badges are a fidelity claim; recording rules |
| 5 | Preferences: theme and mode cookies | Sonnet, medium | Sonnet, low | Small; no-flash check |
| 6 | UI primitives + `TruthBadge` | Sonnet, medium | Haiku, low | shadcn add + one component |
| 7 | Code panes + editor + diagnostics | **Sonnet, high** | **Opus, medium** | CodeMirror state, highlight sync, nonce |
| 8 | Shell layout, examples, page wiring | **Sonnet, high** | Sonnet, medium | Integration; replaces the smoke shell |
| 9 | Playback bar, scrubber, narration | Sonnet, high | Sonnet, medium | Key ownership, markers, live region |
| 10 | 2D event loop + console | **Sonnet, high** | **Opus, medium** | Motion, render isolation, teaching accuracy |
| 11 | Palette, onboarding, `/docs/subset` | Sonnet, medium | Sonnet, low | Contained surfaces |
| 12 | Bottom panel placeholders + interview mode | Sonnet, medium | Sonnet, low | Small, D3-driven |
| 13 | Done-when e2e suite | **Sonnet, high** | **Opus, medium** | The phase's proof |
| 14 | impeccable critique/audit/detect, fix batch, 4 widths | **Opus, medium** | Sonnet, medium | Design judgement |
| 15 | `DESIGN.md` + docs (ADR-048+) | Sonnet, low | Haiku, low | Follows the existing style |
| 16 | Full verification run | Haiku, low | none | Run and report only |
| 17 | Final bug and security review | **Opus, medium** | none | Standing rule (final Opus review) |
| 18 | Fix agreed findings, re-verify, report | Sonnet, medium | Haiku, low | Fixes are already specified |
| any | Debugging a failing test or mismatch | **Opus, high** | — | Root cause first |

**Order.** Tasks run in order, with these exceptions:
- Tasks 3, 4 and 5 may run in parallel once Task 2 is done.
- Task 6 may run in parallel with Tasks 3–5.
- Tasks 9, 10 and 11 may run in parallel once Task 8 is done.

---

### Task 0: Branch and plan commit
**Run with:** Haiku, low. **Review:** none.

- [ ] `git checkout -b phase-6` from `phase-5n`, then commit only this file: `docs: phase 6 plan`.

**Done when:** `git log -1 --oneline` shows `docs: phase 6 plan` on `phase-6`, and `git status --short` is empty.

---

### Task 1: `impeccable shape` and owner decisions
**Run with:** Opus, medium. **Review:** the owner.

**Files:**
- Create: `docs/design/playground-shape.md` (the shape brief)

- [ ] **Step 1:** Run `impeccable shape` for `/playground` (Operate mode, §8.1) with `PRODUCT.md`, `app/globals.css` and §8 as inputs. The brief fixes:
  - the region layout at ≥1280 px, 768 px and 375 px
  - pane density
  - where the badges sit
  - the playback bar anatomy (the controls, the scrubber with markers, the narration line)
  - the empty, loading, refused and failed states of each region
- [ ] **Step 2:** Ask the owner, in one `AskUserQuestion` call:
  1. Confirm or edit D3's mode table.
  2. Should Interview prep's "predict first" be a hidden console with Reveal (as proposed) or a prediction text box compared line by line?
  3. The base playback rate: 4 ticks/s at 1× (ADR-044) or a different constant?
  4. Is the hidden-classes and elements-kinds example wording acceptable before Task 4 records them?

  Record the answers at the top of the brief, and update D3 in this plan if they differ.
- [ ] **Step 3:** Commit: `docs(design): playground shape brief`.

**Done when:** the brief exists with the owner's answers, and every surface in §8.3 that this phase builds has a section in it.

---

### Task 2: CSP styling spike and the no-SSR-style guard
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create: `tests/tooling/no-ssr-style.test.tsx`, `features/playground/components/csp/useNonce.ts` (a `NonceContext` plus `useNonce(): string | undefined`)
- Spike (deleted at the end): `app/playground/spike/page.tsx` plus a client component mounting a CodeMirror view with `EditorView.cspNonce`, a Motion `motion.div` with `layoutId`, a shadcn `Tooltip`, a `cmdk` list, and shadcn `Resizable`
- Modify: `app/playground/page.tsx` (read `x-nonce` and provide `NonceContext`)

**Interfaces — Produces:**
- `NonceProvider({ nonce, children })` and `useNonce()`.
- The rule for every later task (D1): "a component that sets `style` renders it only after mount, or sets it through a ref."
- The D8 verdict: does shadcn `Resizable` emit SSR `style=`?

- [ ] **Step 1:** Under `npm run build && npm run start`, open `/playground/spike` with Playwright, interact with each widget (open the tooltip, type in the cmdk list, drag the resizer, animate the motion div), and collect every console message matching `Content Security Policy`. Record which widget produced which violation.
- [ ] **Step 2:** Fix each violation with the narrowest change: the nonce prop for CodeMirror, client-only mounting, or a ref-set style. Re-run until no violation remains. Decide D8 from the `Resizable` result.
- [ ] **Step 3: Failing guard test** (`no-ssr-style.test.tsx`, Node environment). Render `PlaygroundShell`'s server output (from Task 8; until then, the spike's tree) with `renderToString` from `react-dom/server` and assert that the HTML does not match `/\sstyle="/`. Make it fail first by adding a `style={{}}` probe, then remove the probe.
- [ ] **Step 4:** Delete the spike page. Commit: `test(tooling): forbid SSR style attributes; nonce context for injected styles`.

**Done when:** the spike report lists each widget with its verdict and fix, the guard test exists and passes, and D8 is decided.

---

### Task 3: Timeline markers and Intel asm (core + protocol)
**Run with:** Sonnet, medium. **Review:** Sonnet, low.

**Files:**
- Modify: `core/timeline/boundaries.ts`, `core/timeline/boundaries.test.ts`, `core/views/AsmView.ts`, `core/views/positions.test.ts` (or a new `AsmView.test.ts`), `features/playground/worker/protocol.ts`, `features/playground/worker/handleRequest.ts`, `features/playground/worker/handleRequest.test.ts`, `features/playground/store/playgroundStore.ts`, `features/playground/store/playgroundStore.test.ts`

**Interfaces — Produces:**
- `type TimelineMarker = { index: number; kind: "job"; phase: TickPhase; loopPhase: LoopPhase | null } | { index: number; kind: "warning"; message: string }`.
- `timelineMarkers(ticks: readonly Tick[]): TimelineMarker[]`:
  - a `job` marker at each `jobBoundaries` index
  - a `warning` marker at each tick where a warning message appears that the previous tick did not have
  - sorted by `index`, with a `job` marker before a `warning` marker at the same index
- `AsmLine.intel: string`, from `formatInstruction(ins, "intel")`.
- The `simulated` response gains `markers: TimelineMarker[]`, and its schema caps the array at 10,000 entries (5,000 ticks, each with at most one job and one warning marker). `PlaygroundState.compile.markers: readonly TimelineMarker[]` is reset wherever `boundaries` is reset.

- [ ] **Step 1: Failing tests:**
  - On `nexttick-vs-promise`, the `job` markers' indices equal `[0, 7, 21, 34, 39]`, and marker 7 has `phase: "nextTick"`.
  - On `timeout-vs-immediate-main`, at least one `warning` marker exists, and its `message` contains `Order not guaranteed`.
  - `timelineMarkers([])` is `[]`.
  - Every asm line of a compiled fixture has a non-empty `intel`, and `intel !== text` for a `mov`.
  - Every `simulated` response passes `parseResponse` with `markers`.
  - A `compiled` for a new job resets `compile.markers` to `[]` in the same notification (D2 swap, ADR-041).
- [ ] **Step 2:** `npx vitest run core/timeline/boundaries core/views features/playground/worker features/playground/store` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun → PASS. `npm run test -- tests/conformance/asm.test.ts` stays green, because the bytes are untouched. Commit: `feat(core): timeline markers and intel asm text for the IDE`.

**Done when:** these tests pass, and `asm.test.ts` and `views.test.ts` are unchanged and green.

---

### Task 4: Example catalog and the two new fixtures
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create: `features/playground/examples/examples.config.ts`, `scripts/examples-sync.mts`, `features/playground/examples/catalog.generated.ts` (written by the script), `tests/conformance/examples.test.ts`, `tests/conformance/fixtures/hidden-classes-shapes.cjs`, `tests/conformance/fixtures/elements-kinds-lattice.cjs`
- Modify: `package.json` (`"examples:sync": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/examples-sync.mts"`), `tests/conformance/bytecode-status.json` (via `npm run conformance:status` only)

**Interfaces — Produces:**
- `type ExampleConfig = { id: string; title: string; fixture: string; blurb: string }`. The ten §8.3 titles, in §8.3 order, appear verbatim except "await a thenable (the 2 extra ticks)" and "setTimeout 0 vs setImmediate (nondeterministic!)", which also stay verbatim.
- `type Example = ExampleConfig & { source: string; lang: "js" | "ts"; verified: { node: string; v8: string } | null; nondeterministic: boolean }`, and `EXAMPLES: readonly Example[]`.
  - `verified` is non-null only when the fixture's `*.expected.json` exists and its `target` equals `docs/TARGET.md`.
- `exampleForSource(source: string): Example | null`, an exact byte match.
- The script fails when a configured fixture is missing. It writes deterministic output, and the file header says "generated by npm run examples:sync; do not edit".

- [ ] **Step 1:** Write the two fixtures. They are natives-free and print what the 2D and console views can teach: same versus different property order, and an array that goes SMI → DOUBLE → holey, printed through `console.log` (`util.inspect` output). Each opens with a one-line comment stating the V8 mechanism, like the existing fixtures.
- [ ] **Step 2:** Record them **only on the pinned runtime**. Find a working invocation (e.g. `npx -y node@24.19.0 … scripts/conformance/record.mts`) that the recorder accepts. If none works on this machine, **stop and ask the owner** to record; never write `*.expected.json` by hand. Then run `npm run conformance:status`.
- [ ] **Step 3: Failing test** (`examples.test.ts`):
  - the in-memory catalog equals `catalog.generated.ts` (drift)
  - every example's simulated stdout, stderr and exit code equal one recorded outcome
  - the setImmediate example has `nondeterministic: true`
  - an example whose expectation's `target.node` differs from `TARGET.md` (a test-local copy) gets `verified: null`
  - `exampleForSource(EXAMPLES[0].source + " ")` is `null`
- [ ] **Step 4:** Implement the config and the script, then run `npm run examples:sync`.
- [ ] **Step 5:** `npm run conformance` → PASS, including the two new fixtures. Commit: `feat(playground): example catalog generated from recorded fixtures`.

**Done when:** all ten examples are in the catalog, each with `verified` set from a real recording, and the drift test passes.

---

### Task 5: Preferences (theme and usage mode)
**Run with:** Sonnet, medium. **Review:** Sonnet, low.

**Files:**
- Create: `features/preferences/prefs.ts` (+`prefs.test.ts`), `features/preferences/PreferencesProvider.tsx`, `features/preferences/usePreferences.ts`
- Modify: `app/layout.tsx`, `app/globals.css` (a `.mode-classroom` root type-scale rule; no new color tokens)

**Interfaces — Produces:**
- `type Theme = "dark" | "light"` and `type UsageMode = "self-study" | "interview" | "classroom"`.
- `PREFS_COOKIES = { theme: "sl_theme", mode: "sl_mode" }`.
- `parsePrefs(cookies: { theme?: string; mode?: string }): { theme: Theme; mode: UsageMode; themeExplicit: boolean }`:
  - a Zod `enum` per value
  - the defaults are `dark` and `self-study`
  - in `classroom`, the theme defaults to `light` unless explicit
- `modeDefaults(mode: UsageMode): { speed: PlaybackSpeed; predictFirst: boolean }`, per D3.
- `usePreferences(): { theme; mode; setTheme(t); setMode(m) }`. Each setter writes the cookie (`path=/; max-age=31536000; samesite=lax`, plus `secure` on https), toggles `html.dark` and `html.mode-classroom`, and calls the store's `setSpeed(modeDefaults(m).speed)` on a mode change.
- `app/layout.tsx` reads `cookies()`, calls `parsePrefs` and sets the `<html>` classes on the server.

- [ ] **Step 1: Failing tests:**
  - `parsePrefs({})` gives dark and self-study.
  - `parsePrefs({ mode: "classroom" })` gives the light theme.
  - `parsePrefs({ mode: "classroom", theme: "dark" })` stays dark.
  - `parsePrefs({ theme: "<script>", mode: "x" })` gives the defaults.
  - jsdom: `setTheme("light")` removes `dark` from `document.documentElement` and writes `sl_theme=light`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** `npm run build && npm run start`: with the cookie `sl_theme=light`, the first HTML response's `<html>` has no `dark` class (curl), so there is no flash. Commit: `feat(preferences): theme and usage mode cookies rendered on the server`.

**Done when:** the tests pass and the curl check shows the server-rendered class.

---

### Task 6: UI primitives and `TruthBadge`
**Run with:** Sonnet, medium. **Review:** Haiku, low.

**Files:**
- Create via `npx shadcn@latest add tooltip tabs toggle-group dialog alert-dialog command skeleton badge kbd` (plus `resizable` if D8 chose shadcn): `components/ui/*.tsx`
- Create: `features/playground/components/TruthBadge.tsx` (+`TruthBadge.test.tsx`)

**Interfaces — Produces:**
- `TruthBadge({ level: TruthLevel | "exact-encoding" })`:
  - It renders the level's label with its icon (Global Constraints) and a tooltip.
  - The tooltip text is `TRUTH_TOOLTIPS[level]`. For `"exact-encoding"` it is "Exact encoding of the shown assembly: the bytes are what a real assembler produces for these instructions." (FIDELITY.md row).
  - The trigger is a `button` with `aria-label="<label>: <tooltip>"`.

- [ ] **Step 1: Failing test:** each level renders its label and its `aria-label` contains the exact `TRUTH_TOOLTIPS` sentence; a `switch` over `TruthLevel` in the component is exhaustive (typecheck).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and run the shadcn adds. Check that each added file uses tokens only (no raw hex) and that the no-SSR-style guard still passes. **Step 4:** Run → PASS. Commit: `feat(ui): shadcn primitives and truth badges`.

**Done when:** the badge test passes and `npm run lint` is clean on `components/ui`.

---

### Task 7: Code panes, editor and diagnostics
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create: `features/playground/components/panes/{CodePane.tsx,highlightField.ts,paneDocs.ts,AstPane.tsx,BytecodePane.tsx,MachineCodePane.tsx}`, `features/playground/components/editor/{SourceEditor.tsx,diagnosticsExtension.ts,ProblemsList.tsx,LangToggle.tsx}`, `features/playground/components/panes/highlightField.test.ts`, `features/playground/components/panes/paneDocs.test.ts`, `features/playground/components/editor/ProblemsList.test.tsx`

**Interfaces — Consumes:** `useHighlightedLines(pane)`, `store.setHover`/`clearHover`, `store.setSource`/`setLang`, `compile.views`, `editor.diagnostics`, `useNonce()`, `TruthBadge`.

**Interfaces — Produces:**
- `paneDoc(views: ClientViews, pane: Exclude<Pane, "source">, opts?: { asmSyntax?: "att" | "intel" }): string`. It joins the lines that `LineIndex` counts, in the same order, so line `i` of the document is line `i` of the index. Function headers are **not** extra lines: they render as CodeMirror block widgets, so the index stays aligned.
- `highlightField`: `setHighlights.of({ current: readonly number[]; hovered: readonly number[] })` is a `StateEffect`, and the field maps 0-based lines to line decorations (`cm-sl-current`, `cm-sl-hovered`, with `data-sl-highlight`). Lines `>= doc.lines` are dropped (Review Focus 2).
- `CodePane({ pane, doc, label, truth })`:
  - read-only (`EditorState.readOnly`, `EditorView.editable.of(false)`), `EditorView.cspNonce.of(useNonce())`
  - `mousemove` → `setHover(pane, line)` (rAF-throttled), `mouseleave` → `clearHover()`
  - it dispatches `setHighlights` when `useHighlightedLines(pane)` changes, and scrolls the first `current` line into view (`EditorView.scrollIntoView`, `y: "nearest"`)
- `SourceEditor`: editable CodeMirror with `javascript({ typescript: lang === "ts" })`, `onChange → setSource`, the source pane highlights, and `diagnosticsExtension(diagnostics)`, which maps each `Diagnostic` to a `@codemirror/lint` diagnostic (`range` → from/to, `message`, the hint as a second line, and `severity: "error"`).
- `ProblemsList`: one row per diagnostic, `L<line>:<col> <code> <message>`, with the hint and a "Why?" link to `docsHref(d)` (Task 11's `/docs/subset#<code>`, D7). Clicking a row focuses the editor at the range.
- `LangToggle`: a toggle group JS/TS → `setLang`.
- `MachineCodePane`: an asm/hex/binary segmented toggle and an AT&T/Intel toggle. Badges: asm Illustrative, bytes `"exact-encoding"`. Panes: AST Exact, Bytecode Verified model, Source and Console Exact.

- [ ] **Step 1: Failing tests:**
  - `paneDoc(views, p).split("\n").length === lineIndex.panes[p].length` for every pane, on `nexttick-vs-promise` (via `fixtureRun`)
  - `highlightField`: highlighting line 30 of a 40-line document, then replacing the document with 3 lines and re-dispatching `{ current: [30], hovered: [] }`, throws nothing and leaves zero decorations (Review Focus 2)
  - in a jsdom `EditorView`, the `current` line carries `data-sl-highlight="current"`
  - `ProblemsList` for `Math.random()` shows `E_EXCLUDED_API`, the hint, and a link to `/docs/subset#E_EXCLUDED_API`
- [ ] **Step 2:** `npx vitest run features/playground/components` → FAIL.
- [ ] **Step 3:** Implement. The panes and the editor load through `next/dynamic(() => import(...), { ssr: false, loading: PaneSkeleton })`, and the skeleton has the pane's final height.
- [ ] **Step 4:** Rerun → PASS. Commit: `feat(playground): synchronized code panes, editor and diagnostics`.

**Done when:** these tests pass, and in `next dev`, hovering a bytecode line outlines lines in the source, AST and asm panes (a manual `webapp-testing` check, screenshot in the report).

---

### Task 8: Shell layout, examples and page wiring
**Run with:** Sonnet, high. **Review:** Sonnet, medium.

**Files:**
- Create: `features/playground/components/{PlaygroundShell.tsx,ResizableSplit.tsx}` (the latter only if D8 chose in-house), `features/playground/components/examples/{ExamplesMenu.tsx,VerifiedBadge.tsx,ExamplesMenu.test.tsx}`, `features/playground/examples/useActiveExample.ts`
- Modify: `app/playground/page.tsx`, `e2e/playground.spec.ts`, `e2e/playground-worker.spec.ts`, `e2e/security.spec.ts` (heading assertion)
- Delete: `features/playground/components/PipelineSmoke.tsx`

**Interfaces — Produces:**
- `PlaygroundShell()` holds the regions from the Task 1 brief:
  - **left:** `SourceEditor` + `LangToggle` + `ExamplesMenu` + `VerifiedBadge` + `ProblemsList`
  - **right:** tabs AST | Bytecode | Machine Code
  - **bottom** (collapsible): tabs Event Loop | V8 Internals | Hardware, the `PlaybackBar` and the `NarrationLine`
- At `< 1024px` the regions stack behind a segmented control (Editor | Code | Run), and the 3D tab is hidden on mobile (§8.3).
- The page heading is a visually hidden `h1` "Playground".
- The status is shown as text in a `role="status"` element with `data-testid="status"`, which keeps the Phase 5 e2e hooks.
- `useActiveExample(): Example | null` is `exampleForSource(editor.source)`, memoized on the source.
- `VerifiedBadge`: "Matches Node v24.19.0 (V8 13.6.233.17-node.51)" with `Check` when `verified`, otherwise "Simulated by spec model". The nondeterministic example adds a `TriangleAlert` "Order not guaranteed in real Node" chip.
- `ExamplesMenu`: a menu of the ten examples, each with its blurb and badge. Choosing one calls `setSource` + `setLang`, but goes through an `AlertDialog` "Replace your code with '<title>'?" when the current source is non-empty and is not an example (Review Focus 5).
- **The empty editor** (an empty source) shows an inline empty state listing the examples (§8.2 "empty states teach").
- `app/playground/page.tsx`: an async Server Component. It reads `x-nonce` and the preferences, then renders `NonceProvider` → `PlaygroundProvider initialSource={EXAMPLES[1].source}` ("nextTick vs Promise") → `MotionConfig reducedMotion="user"` → `PlaygroundShell`.

- [ ] **Step 1: Failing tests** (jsdom):
  - with an edited non-example source, choosing "nextTick vs Promise" opens the dialog and Cancel leaves the source unchanged; Confirm replaces it
  - with an example's source loaded, choosing another replaces it with no dialog
  - `VerifiedBadge` shows "Simulated by spec model" after one character is appended
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement, delete the smoke shell, and update the two Phase 5 e2e specs to the new labels (the editor is now CodeMirror: select all in `.cm-content`, then `page.keyboard.insertText(source)`; there is no test hook in the app).
- [ ] **Step 4:** Rerun the unit tests → PASS. Run `npm run build` and record the `/playground` first-load JS (gzip). It must stay ≤ 250 KB, with CodeMirror and Motion in lazy chunks; name them. If it exceeds the budget, stop and report before Task 9. Run `npm run e2e -- playground security` → PASS. Commit: `feat(playground): IDE shell with examples and verified badges`.

**Done when:** the shell renders all three regions at 1280 px, the Phase 5 e2e passes on it, and the report gives the measured first-load JS.

---

### Task 9: Playback bar, scrubber and narration
**Run with:** Sonnet, high. **Review:** Sonnet, medium.

**Files:**
- Create: `features/playground/components/playback/{PlaybackBar.tsx,Scrubber.tsx,NarrationLine.tsx,StopNotice.tsx}`, `features/playground/components/playback/playback.test.tsx`

**Interfaces — Consumes:** `playback.*`, `compile.markers`, `compile.stop`, `compile.status`, `useNarration`, `useFidelityWarnings`, and the store actions.

**Interfaces — Produces:**
- `PlaybackBar` holds:
  - icon buttons for first, boundary-back, step-back, play/pause, step-forward, boundary-forward and last, each with an `aria-label`, a tooltip and its `Kbd` shortcut
  - a speed toggle group over `PLAYBACK_SPEEDS` (`0.25×`…`8×`)
  - `Tick <index+1> / <length>` in tabular numerals

  Every control is disabled at length 0.
- `Scrubber`: `role="slider"`, `aria-valuemin=0`, `aria-valuemax=length-1`, `aria-valuenow=index`, and `aria-valuetext="Tick <n>, <phase>"`.
  - It handles its own arrows, Home and End and stops propagation. Its role is in ADR-047's widget list, so the global shortcuts skip it.
  - Markers render under the track:
    - `job` markers: a short tick colored by phase (microtask violet, nextTick violet outline, timers/check amber, script and exit neutral), with the phase name in a tooltip
    - `warning` markers: a yellow `TriangleAlert` with the message in a tooltip
  - The thumb position is set through a ref (D1).
- `NarrationLine`: the current narration in an `aria-live="polite"` region, with a fixed height of two lines and overflow scrolling, so the layout never shifts.
- `StopNotice`: when `compile.stop` is non-null, "Simulation limit reached — real Node would continue" plus the limit name, styled as a warning and never as a JS error.

- [ ] **Step 1: Failing tests:**
  - **Review Focus 3:** with the scrubber focused at index 3, one `ArrowRight` keydown makes `index === 4`, with `useShortcuts` mounted. `Space` keydown on the Play button toggles `isPlaying` exactly once.
  - The scrubber renders one marker element per `compile.markers` entry, and the warning markers carry the warning message as accessible text.
  - At length 0, every playback button is `disabled`.
  - `StopNotice` renders the exact notice text for a `stop` value and nothing for `null`.
  - The narration's fixed height is proven by Task 13's CLS check, not here.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. Commit: `feat(playground): playback bar with phase and fidelity markers, live narration`.

**Done when:** these tests pass.

---

### Task 10: 2D event loop and console
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create: `features/event-loop-2d/{EventLoopView.tsx,CallStackRegion.tsx,QueueRegion.tsx,HostApisRegion.tsx,PhaseRing.tsx,ConsolePanel.tsx,TaskChip.tsx}`, `features/event-loop-2d/eventLoop.test.tsx`
- Modify: `eslint.config.mjs` + `tests/tooling/eslint-boundaries.test.ts` only if `features/event-loop-2d` needs to be listed for the `features/` rule

**Interfaces — Consumes:** `useCallStack`, `useQueues`, `useLoopPhase`, `useConsole`, `useFidelityWarnings`, the `TaskRef` fields (`id`, `kind`, `label`, `origin`) and `HostEntry`.

**Interfaces — Produces:**
- `EventLoopView`, with two ownership groups, each labelled in text:
  - **"V8"**: the Call Stack and the Microtask queue ("owned by V8")
  - **"Node / libuv"**: Host APIs, the nextTick queue, the Timers queue, the Check (setImmediate) queue and the phase ring ("owned by Node/libuv")
  - Each region has a heading and `aria-label` and `data-testid` values of `region-call-stack`, `region-microtask`, `region-nexttick`, `region-timers`, `region-check` and `region-host`.
- `TaskChip({ task })`: `motion.li` with `layoutId={"task-" + task.id}`, the `label` in mono, and the `origin` in a tooltip. The color follows the role table, always with a text label.
  - A task whose label appears in a current `nondeterminism` warning gets a yellow warning chip.
  - Motion only mounts on the client (D1).
- `CallStackRegion`: frames, newest on top. Each frame enters with `spring { stiffness: 500, damping: 32 }` and exits with a fade-up, inside `AnimatePresence mode="popLayout"`.
- `QueueRegion({ title, owner, tasks, tone })`: at most 12 chips plus a "+N more" chip (Review Focus 4). It shows a teaching empty state ("empty: the loop moves on").
- `PhaseRing`: timers → pending → poll → check → close, with the current `loopPhase` highlighted (green, plus an `aria-current="step"` label). It shows "running the main script" or "draining nextTicks/microtasks" when `loopPhase` is null, from `phase`.
- `ConsolePanel`: `stdout`/`stderr` lines as text nodes (stderr in red with a label), Exact badge, and `data-testid="console"`. Under predict-first (Task 12) it is gated.

- [ ] **Step 1: Failing tests** (jsdom, `fixtureRun("nexttick-vs-promise")`):
  - at index 7, `region-nexttick` lists 2 chips reading `process.nextTick((anonymous))`, and `region-microtask` lists 2 reading `then((anonymous))` (the probed facts)
  - **Review Focus 4:** a `QueueRegion` given 200 tasks renders 12 chips and a chip reading `+188 more`
  - **render isolation:** across seeks between two ticks whose `console` is the same reference, `ConsolePanel` renders zero extra times (a render counter, as in Phase 5's `hooks.test.tsx`)
  - at the last tick, the console text equals the recorded stdout
  - on `timeout-vs-immediate-main`, at a tick with a nondeterminism warning, the affected chips show the warning chip
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with the `motion-design` and `animate` skills. **Step 4:** Run → PASS. Commit: `feat(event-loop-2d): animated loop view with V8 and Node ownership`.

**Done when:** these tests pass, and the no-SSR-style guard still passes with the view in the shell.

---

### Task 11: Command palette, onboarding and `/docs/subset`
**Run with:** Sonnet, medium. **Review:** Sonnet, low.

**Files:**
- Create: `features/playground/components/palette/CommandPalette.tsx`, `features/playground/components/onboarding/CoachMarks.tsx`, `features/playground/components/onboarding/coachMarks.test.tsx`, `app/docs/subset/page.tsx`, `features/playground/diagnostics/docsHref.ts` (+test)
- Modify: `features/playground/store/PlaygroundProvider.tsx` (the `useRunNow` context)

**Interfaces — Produces:**
- `CommandPalette`: opens on `⌘K`/`Ctrl+K` (also outside editable targets; inside CodeMirror too, because the chord has a modifier and ADR-047 ignores modifiers). Its commands:
  - **Run:** `useRunNow()`, a context that `PlaygroundProvider` fills with its `client.flush` (modify `PlaygroundProvider.tsx`), so the pending debounce dispatches at once
  - **Examples ›** (the ten)
  - **Go to tick…:** a number, then `seek(n-1)`
  - **Toggle 3D:** selects the Hardware tab
  - **Show stripped JS:** a dialog with `compile.strippedJs` as a read-only CodeMirror document
  - **Theme:** light or dark
  - **Mode ›**
- `CoachMarks`: three dismissible steps (the editor and examples, the panes and hover, Play and the scrubber), anchored to their targets and portalled. `localStorage["sl_onboarded"] = "1"` on dismiss or finish, and they never show again on that device. Reads and writes are wrapped in `try`/`catch`, so blocked storage shows the marks once per load and never throws. The e2e sets the key with `addInitScript`; there is no test-only branch in the component.
- `docsHref(d: Diagnostic): string`: `/docs/subset#${d.code}` when `d.docs` is set, else `/docs/subset`.
- `/docs/subset` (Read mode: a 65–75ch measure, a Server Component): renders the limits table from `core/shared/limits.ts` and the excluded table from `core/frontend/subset/excluded.ts`, with `id={code}` anchors and each reason in plain words.

- [ ] **Step 1: Failing tests:**
  - coach marks show step 1 when the key is absent, Next advances, Esc dismisses and sets the key, and with the key present nothing renders
  - `docsHref` covers both branches
  - jsdom: `Ctrl+K` opens the palette, and choosing "Go to tick…" with `5` calls `seek(4)`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. Commit: `feat(playground): command palette, onboarding and subset reference`.

**Done when:** these tests pass, and `/docs/subset` builds and lists every `E_*` code that has an anchor target.

---

### Task 12: Bottom-panel placeholders and interview mode
**Run with:** Sonnet, medium. **Review:** Sonnet, low.

**Files:**
- Create: `features/playground/components/bottom/{BottomPanel.tsx,PlaceholderPanel.tsx}`, `features/playground/components/bottom/predictFirst.test.tsx`
- Modify: `features/event-loop-2d/ConsolePanel.tsx`

**Interfaces — Produces:**
- `BottomPanel`: tabs Event Loop (2D) | V8 Internals | Hardware (3D), collapsible with `aria-expanded`.
  - V8 Internals and Hardware render a `PlaceholderPanel` that names what Phase 7 adds and why, with no fake data and no "coming soon" filler.
  - The Hardware tab shows its Illustrative badge.
- **Predict-first** (D3, as the owner confirmed it in Task 1): when `modeDefaults(mode).predictFirst`, `ConsolePanel` shows "Predict the output, then reveal" and a Reveal button until Reveal is pressed or `index === length-1`. It resets on a new job (`compile.jobId` change).

- [ ] **Step 1: Failing tests:**
  - in `interview` mode the console text is hidden at index 0, and shown after Reveal or after `seek(length-1)`
  - a new `compiled` hides it again
  - in `self-study` it is always shown
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. Commit: `feat(playground): bottom panel and interview predict-first`.

**Done when:** these tests pass.

---

### Task 13: Done-when e2e suite
**Run with:** Sonnet, high. **Review:** Opus, medium.

**Files:**
- Create: `e2e/playground-ide.spec.ts`, `e2e/playground-a11y.spec.ts`, `e2e/playground-responsive.spec.ts`, `e2e/helpers/playground.ts` (sets `sl_onboarded` via `addInitScript`, collects CSP messages and page errors, loads an example through the menu, and waits for `status` to read `ready`)

**Every spec:** after it ends, the collected CSP messages and `pageerror`s are `[]`.

- [ ] **Step 1: Write the specs** against `npm run e2e` (the production server):
  - **Step through "nextTick vs Promise".**
    - Load it, then press `Shift+→` once from tick 1: the status shows `Tick 8 / 40`, `region-nexttick` has 2 chips and `region-microtask` has 2.
    - Press `→` repeatedly to the end, recording the console text after each step. Every recorded snapshot is a prefix of the recorded stdout, the lines appear in its order, and the final text equals it (read from `*.expected.json`).
  - **Hover sync.** Hover the bytecode pane line whose `current`-mapped source line holds `console.log("sync 1")`. The source, AST and asm panes each contain at least one `[data-sl-highlight="hovered"]` line, and the source one contains `sync 1`.
  - **Nondeterminism.** Load "setTimeout 0 vs setImmediate (nondeterministic!)". The verified badge shows the "Order not guaranteed in real Node" chip, and after Play to the end, the scrubber has a warning marker and the narration or warning region contains `Order not guaranteed in real Node`.
  - **CLS.** Install a `PerformanceObserver({ type: "layout-shift", buffered: true })` before Play. Play at 8× to the end, then assert the summed `value` of entries without `hadRecentInput` is `< 0.01`.
  - **CSP** across mounts: open the palette, a tooltip, the Show stripped JS dialog, switch the theme, the Machine Code tab with Intel and Binary, and the 2D view during playback. There are zero CSP messages.
  - **axe** (`playground-a11y.spec.ts`): `AxeBuilder` with tags `wcag2a`, `wcag2aa`, `wcag21aa` and `wcag22aa`, on the loaded example in the dark theme, the light theme, and with the palette open. There are zero violations.
  - **Reduced motion:** with `page.emulateMedia({ reducedMotion: "reduce" })`, play 10 steps: no element has a running Web Animation (`document.getAnimations().length === 0`) after each step settles.
  - **Responsive** (`playground-responsive.spec.ts`): at widths 375, 768, 1280 and 1440, `document.documentElement.scrollWidth <= innerWidth`. Each width shows its region layout (the segmented control below 1024), and a full-page screenshot goes to `test-results/phase6/<width>.png` for the report.
- [ ] **Step 2:** `npm run e2e` → fix the UI (never the assertions' recorded values) until PASS.
- [ ] **Step 3:** Commit: `test(e2e): phase 6 done-when suite`.

**Done when:** the whole `npm run e2e` passes, including Phase 1 and Phase 5 specs.

---

### Task 14: impeccable critique, audit and detect; fix batch; four widths
**Run with:** Opus, medium. **Review:** Sonnet, medium.

- [ ] **Step 1:** Run `impeccable critique` and `impeccable audit` on `/playground` (`npm run dev`, using `webapp-testing` screenshots at 375, 768, 1280 and 1440 px, both themes, all three modes). Also run `design:accessibility-review`.
- [ ] **Step 2:** List every finding with an agree or reject verdict, and a reason for each rejection.
- [ ] **Step 3:** Fix all agreed findings in **one batch**. Re-run `npm test` and `npm run e2e`.
- [ ] **Step 4:** Run `impeccable detect --json <changed files>` once for the surface. The result is clean, or every remaining finding has a written justification.
- [ ] **Step 5:** Commit: `fix(playground): impeccable critique and audit batch`.

**Done when:** the findings table, the detect output and the four-width screenshots are in the report.

---

### Task 15: `DESIGN.md` and docs
**Run with:** Sonnet, low. **Review:** Haiku, low.

- [ ] Run `impeccable document` to write `DESIGN.md` from the shipped surface (tokens, type scale, the color roles, badges, motion values, region layouts per breakpoint, states). Update the `globals.css` header comment, which says "DESIGN.md records the realized system after Phase 5", to point at it.
- [ ] Write ADR-048 onward for D1–D8. Record the Task 2 spike outcome (widget → violation → fix) in D1's ADR, and the measured first-load JS and lazy chunk names in D6's.
- [ ] `docs/ARCHITECTURE.md`: a "Phase 6: the IDE" section with the read and write paths (`hooks → components`, `components → actions`), the D1 CSP rule and the region map.
- [ ] `docs/FIDELITY.md`: add rows for the example badges ("Matches Node vX" only for recorded fixtures; user programs show "Simulated by spec model", ADR for D2) and for the 2D view ("Exact" ordering; animation is presentation only).
- [ ] `PROMPT.md` status line: Phase 6 implemented, its plan and its ADRs. `CLAUDE.md`: add the `npm run examples:sync` row (keep the project section under 60 lines).
- [ ] Commit: `docs: phase 6 design system, decisions and architecture`.

**Done when:** every decision D1–D8 has an ADR, and `DESIGN.md` exists.

---

### Task 16: Full verification
**Run with:** Haiku, low. **Review:** none.

- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run conformance`, `npm run build` (which includes `check-build`) and `npm run e2e`, and report the output verbatim.
  - `git status` shows no `*.expected.json` diffs other than the two new fixtures from Task 4.
  - Report the `/playground` first-load JS (gzip).
- [ ] Any failure goes back to the orchestrator, which dispatches the fix with the failing task's model.

**Done when:** all six commands pass, with their output shown.

---

### Task 17: Final review
**Run with:** Opus, medium. **Review:** none.

- [ ] Run a bug and security review of `git diff phase-5n...phase-6`, focused on:
  - CSP (SSR `style=`, unnonced `<style>`, any `'unsafe-inline'` creep)
  - user text reaching HTML (`dangerouslySetInnerHTML`, CodeMirror widgets building DOM from source, tooltips with `label`/`origin`)
  - the preference cookies (validation, no reflection into markup beyond the enum)
  - render isolation (a component subscribing to the whole state, or a fresh object per tick)
  - leaks (CodeMirror views, listeners, rAF throttles and Motion after unmount)
  - keyboard ownership (ADR-047 regressions)
  - axe-invisible accessibility issues (focus traps in dialogs, focus return)

**Done when:** a findings list exists, ranked by severity, with a verdict for each.

---

### Task 18: Fix agreed findings, re-verify, report
**Run with:** Sonnet, medium. **Review:** Haiku, low.

- [ ] Fix the findings the orchestrator accepted, list the rejected ones with reasons, and re-run Task 16.
- [ ] Report per PROMPT §4 step 6, then **stop for review**. The report covers:
  - what was built
  - the verification output
  - the ADRs
  - the fidelity gaps (none expected beyond the badge rules)
  - the open risks below
  - the four-width screenshots

**Done when:** Task 16 passes again after the fixes, and the report is delivered.

---

## Done-when → test map

| PROMPT Phase 6 criterion | Proof |
|---|---|
| critique + audit fixed in one batch | Task 14 findings table + commit |
| `impeccable detect` clean or justified | Task 14 Step 4 output |
| checked at 375, 768, 1280, 1440 px | `e2e/playground-responsive.spec.ts` + Task 14 screenshots |
| `DESIGN.md` written | Task 15 |
| steps "nextTick vs Promise": queues + console = recorded stdout | `e2e/playground-ide.spec.ts`; `features/event-loop-2d/eventLoop.test.tsx` |
| bytecode hover → source, AST, asm highlights | `e2e/playground-ide.spec.ts`; `highlightField.test.ts` |
| setImmediate example shows the nondeterminism warning | `e2e/playground-ide.spec.ts`; `boundaries.test.ts` (warning marker) |
| passes axe | `e2e/playground-a11y.spec.ts` |
| no CLS during playback | `e2e/playground-ide.spec.ts` (layout-shift < 0.01) |
| no CSP violations | every e2e spec's collector; `tests/tooling/no-ssr-style.test.tsx` |
| examples carry verified badges (§8.3, §3.4.5) | `tests/conformance/examples.test.ts` |
| reduced-motion support | `e2e/playground-ide.spec.ts` (reduced motion) |

## Open risks

- **The bundle budget.** First-load JS was 232 KB of the 250 KB budget before this phase. Radix, the shell and the store add to it; CodeMirror and Motion must stay lazy. Task 8 measures it and stops if the budget is exceeded. Phase 9 enforces it.
- **Recording the two new fixtures needs Node 24.19.0,** which this machine lacks. Task 4 tries `npx node@24.19.0`, and the owner records them if that fails. Until then those two examples ship with `verified: null` and the "Simulated by spec model" badge, never a fake one.
- **The worker CSP gap** (ADR-047) is unchanged: the worker chunk has no CSP header of its own. It is a server-layer change, deferred to Phase 9's CSP review.
- **The bytecode pane's feedback-slot links** to the IC view (§8.3) need Phase 7's IC table. Phase 6 renders the slots as plain text.
- **Per-user mode persistence** is per device (cookies) until accounts have a preferences field (Phase 8).
- **Deep links** (`?t=42`) are Phase 8. `seek` already clamps, and "Go to tick" uses the same path.
- **The landing page's live mini-visualizer** (Persuade mode) is not in Phase 6's list. It stays a placeholder.
