# `/playground` shape brief (Phase 6)

Output of `impeccable shape` for `/playground`, in **Operate** mode (PROMPT §8.1). Inputs: `PRODUCT.md`, `app/globals.css`, PROMPT §8 (all of it), ADR-005, ADR-012, ADR-040 to ADR-047, and the Phase 6 plan (`docs/superpowers/plans/2026-10-25-phase-6-ide-ui-event-loop-2d.md`, D1 to D8). Where these conflict, the ADRs and the plan win over §8, as the plan says; every such case is listed in the final section.

This brief fixes intent, hierarchy and states. It does not set CSS values beyond naming tokens, and it writes no code.

## Owner decisions

The owner answered Task 1's four questions on 2026-10-25. None differs from the plan, so the plan's D3 is unchanged.

1. **Usage modes: D3 is confirmed as proposed.**

   | Mode | Theme | Type scale | Default speed | Density | Output |
   |---|---|---|---|---|---|
   | Self-study | user's | 1× | 1× | dense | shown live |
   | Interview prep | user's | 1× | 2× | dense | **predict first**: the console shows "Predict the output, then reveal" until Reveal or the last tick |
   | Classroom | light (overridable) | 1.125× root | 0.5× | roomy | shown live |

2. **Interview prep's "predict first" is a hidden console with a Reveal button**, not a prediction text box compared line by line.
3. **The base playback rate stays 4 ticks/s at 1×** (`BASE_TICKS_PER_SECOND = 4`, ADR-044).
4. **The hidden-classes and elements-kinds example wording is acceptable.** Task 4 re-checks it against the recorded output, and the blurbs change if the recording disagrees with them.

## Process note

Shape normally runs a discovery interview. Here, the product questions are already settled by `PRODUCT.md` (users, modes, voice, limits), §8 (surfaces, roles, motion) and the plan. The four open questions were answered by the owner above, so no further interview round ran, and nothing below is an unconfirmed assumption except the items marked **Judgement** in the last section.

## 1. Job, audience and mode

- **Who arrives.** CS students and bootcamp learners at a laptop (Self-study), interviewees drilling "what does this print?" (Interview prep), and an instructor projecting to a room (Classroom).
- **The job.** Pick or type a small JS/TS program, then step through what V8 compiles and what Node runs, and come away able to say *why* it printed in that order.
- **Mode: Operate.** This is an IDE. Scanability, stable positions, keyboard speed and native-feeling widgets outrank expression. The brand lives in precise details: the truth badges, the ownership labels ("owned by V8", "owned by Node/libuv"), the phase-colored scrubber, and a narration that names the mechanism.

## 2. Outcome and proof

- **Primary task.** Load "nextTick vs Promise" (the default source), press Play, and watch the nextTick queue drain before the microtask queue, while the console prints exactly what real Node printed.
- **Proof on screen.** The editor's "Matches Node v24.19.0 (V8 13.6.233.17-node.51)" badge appears only when the source equals a recorded example byte for byte (D2). Every pane and view carries its truth badge. Nondeterministic orderings carry "Order not guaranteed in real Node". Nothing is fabricated: no fake data in placeholder panels, no "coming soon" filler.
- **Success.** The learner can predict the next program's output and name the reason, which the narration taught them.

## 3. Direction: inherit the incumbent world

There is no `DESIGN.md` yet, but `app/globals.css` already defines a coherent world (Phase 0): a deep slate OLED IDE with a second neutral panel layer, a light classroom theme, saturated accents reserved for state, IBM Plex Sans for UI and JetBrains Mono for machine text, a 1.125 rem scale, and 220 ms / 150 ms enter and exit durations. **This surface extends that world; it does not invent a new one.** `DESIGN.md` records the realized system in Task 15.

- **Structural thesis.** Three regions that mirror V8's pipeline and Node's run: *what you wrote* (left), *what V8 made of it* (right), *what Node did with it, tick by tick* (bottom). The playback bar is the spine that ties them together, and the highlight sync (solid for the current tick, outline for hover) is the thread you can see.
- **Focal moment.** A callback chip visibly travelling from a queue onto the Call Stack (a shared `layoutId`) as the scrubber advances, with the narration saying why.
- **Glow only on active elements.** Green marks the current tick only: the current line highlight, the current phase in the phase ring, the Play button. Nothing else glows.
- **Surfaces.** `bg-background` for the page, `bg-panel` for region bodies, `bg-card` for chips, frames and popovers, `border-border` for dividers. No raw hex anywhere. Any new token goes into both themes and `tests/tooling/contrast.test.ts` at 4.5:1 or better.

## 4. Scope and boundaries

**Built in Phase 6:** the page frame and top bar, the three-region layout with its narrow-screen segmented control, the editor region (editor, JS/TS toggle, examples, verified badge, diagnostics, problems list), the AST, Bytecode and Machine Code panes, the bottom panel and its tabs, the playback bar, scrubber, narration line and stop notice, the 2D event loop, the console, placeholder panels for V8 Internals and Hardware, the command palette, onboarding coach marks, `/docs/subset`, usage modes and theme, and reduced-motion support.

**Not built here:** the V8 Internals panels and the 3D board (Phase 7), deep links `?t=42`, saving and sharing (Phase 8), the landing page's mini-visualizer, `/dashboard`, and `/admin`. Bytecode feedback slots render as plain text until Phase 7's IC table exists.

**Anti-goals.** It feels wrong, however polished, if:
- the event loop is ever implied to be part of V8
- a modeled or illustrative view looks as authoritative as an Exact one
- anything shifts while playing (CLS must stay below 0.01 during playback)
- a limit stop reads like a JavaScript error
- choosing an example silently destroys the learner's code
- motion decorates instead of conveying state

## 5. Usage modes in the UI

- **The control.** A visible segmented control in the top bar, "Self-study | Interview | Classroom", with the full name in each option's tooltip and in the palette's "Mode ›". It persists in the `sl_mode` cookie (D3), so the first paint is already right.
- **Switching modes** applies that mode's defaults for speed and density at once. Theme follows the mode only when the learner has not chosen a theme explicitly: Classroom proposes light, and an explicit theme choice (`sl_theme`) always wins.
- **Density**, as each mode applies it, is set out in §7.
- **Predict first** (Interview prep) gates only the console (§10.8). The 2D view, panes and narration stay live, because stepping is how the learner checks the prediction.

## 6. Page frame and top bar

- **The top bar** is one slim row above all regions:
  - left: the "Silicon Loop" wordmark (a link home) and the visually hidden `h1` "Playground"
  - centre-left: the status as text in `role="status"` with `data-testid="status"` (Idle, Compiling…, Simulating…, Ready, Refused, Failed), with an icon per status so it never relies on color
  - right: the mode control, the theme toggle (`Sun`/`Moon`, icon-only with `aria-label` and tooltip), and a "⌘K" command button showing its `Kbd` hint
- **At 375 px** the mode control collapses into a button that still shows the current mode ("Self-study ▾") and opens a menu, so the mode remains visible as `PRODUCT.md` requires. The theme toggle moves into the same menu.
- **Run.** Compilation is debounced and automatic (Phase 5), so there is no permanent Run button. "Run" lives in the palette and flushes the debounce.

## 7. Region layout and density

### Breakpoints

| Width | Layout |
|---|---|
| **≥ 1280 px** | Three resizable regions (§8.3). Left editor about 40% (min 360 px) and right panes about 60%, side by side over the top ~60% of the height. The bottom region spans the full width below them (~40%). Inside the bottom, on the Event Loop tab, the 2D view takes ~70% and the console ~30% as a column on the right. |
| **1024–1279 px** | The same three regions, with the editor at ~45%. The console moves from a side column to a strip under the 2D view, so the queues keep their width. |
| **768–1023 px** | Stacked. A full-width segmented control under the top bar, **Editor | Code | Run**, shows one region at a time. The playback bar and narration are pinned to the bottom of the viewport in every segment, so the learner can step while reading code. The 2D view's two ownership groups sit side by side, with the console below them. |
| **375–767 px** | Stacked as at 768, with a single column. The 2D view stacks the V8 group above the Node/libuv group, the phase ring becomes a linear five-step row, and the playback bar takes its compact form (§10.4). The Hardware tab is hidden (plan Task 8; see the conflicts section). |

- **Resizing** (≥ 1024 px): two drag handles (editor/panes and top/bottom), each a keyboard-operable separator with an `aria-label`, sizes set through refs (D1, D8), and a double-click to reset. Each region has a minimum size, so no pane collapses to an unreadable sliver.
- **Collapsing the bottom region** hides only its tab content. The tab strip, the playback bar and the narration line stay visible, because playback drives the panes too.
- **No horizontal page scroll at any width.** Code panes scroll inside themselves.
- **Segment switches** keep each region's scroll position and active tab. The hover highlight clears when its pane is hidden.

### Density

- **Dense (Self-study and Interview prep).** UI text at `text-sm`, labels and badges at `text-xs`, code at `text-sm` mono with tabular numerals and a line height of about 1.5. Toolbars are compact on fine pointers.
- **Roomy (Classroom).** The root scales to 1.125×, so the whole rem scale grows with it. Code line height grows to about 1.6, padding inside regions grows one step, and the 2D view's chips grow with the type. Positions never move between modes; only sizes do.
- **Touch targets.** On coarse pointers every control is at least 44×44 px with at least 8 px between targets. On fine pointers dense toolbars may draw smaller but keep a hit area of at least 24×24 px (WCAG 2.2 target size).
- **The gutter** in every code pane shows line numbers (offsets in Bytecode, addresses in Machine Code) in `text-muted-foreground`.

## 8. Truth badges

- **Position.** Each region's header row holds its tabs on the left and **the active tab's truth badge on the right**. It changes with the tab, so the learner always sees the level of the view in front of them. Panels inside a view (the console, and Phase 7's internals panels) carry their own badge at the right of their own header.
- **Look.** Quiet: `text-xs`, `text-muted-foreground`, a Lucide icon, never a filled color. Modeled adds a dashed outline. The tooltip is the exact `TRUTH_TOOLTIPS` text from `core/shared/fidelity.ts`, and the badge is focusable so keyboard users reach the tooltip.

| Where | Badge |
|---|---|
| Editor (source) | none; it shows the `VerifiedBadge` instead (§10.1) |
| AST & scopes | Exact (`Check`) |
| Bytecode | Verified model (`FlaskConical`) |
| Machine Code: assembly | Illustrative (`PencilLine`) |
| Machine Code: Hex/Binary bytes | "Exact encoding of the shown assembly" (see the conflicts section) |
| Event Loop (2D) | Exact (`Check`): ordering and queue contents are Exact |
| Console | Exact (`Check`) |
| V8 Internals placeholder | none (no data is shown; it lists the levels its panels will carry) |
| Hardware placeholder | Illustrative (`PencilLine`) |

## 9. Color, icons and type (applied)

- **Roles.** Microtask violet (`text-microtask`), nextTick violet outline plus a "nextTick" label, timers and immediates amber (`text-macrotask`) with phase labels, Host APIs cyan (`text-webapi`), errors red (`text-destructive`), fidelity warnings yellow (`text-warning`), current tick green (`text-current`). Every role is paired with a label or an icon.
- **Icons.** Lucide only. Proposed: Call Stack `Layers`, Microtask `CircleDot`, nextTick `Circle`, Timers `Timer`, Check (setImmediate) `SkipForward`, Host APIs `Cable`, phase ring `RefreshCw`, warning `TriangleAlert`, error `CircleX`, limit stop `OctagonPause`. `Check` stays reserved for the Exact badge and the verified badge, so it is never reused for the Check phase.
- **Type.** IBM Plex Sans for every UI string. JetBrains Mono with tabular numerals only for source, AST node text, bytecode, asm, hex, binary, registers, addresses, task labels, tick counters and console output.

## 10. Surfaces

### 10.1 Editor region (left)

- **Header row:** the `LangToggle` (JS | TS, a two-option toggle group), the `ExamplesMenu` trigger ("Examples", `BookOpen`), and on the right the `VerifiedBadge`.
- **`VerifiedBadge`.** "Matches Node v24.19.0 (V8 13.6.233.17-node.51)" with `Check` when the source equals a verified example; otherwise "Simulated by spec model" (muted, no icon color). The nondeterministic example adds a yellow `TriangleAlert` chip "Order not guaranteed in real Node". An example still awaiting its recording (`verified: null`) shows "Simulated by spec model", never a fake badge.
- **`ExamplesMenu`.** A menu of the ten examples in §8.3's order, each row showing its title, its one-line teaching blurb and its badge. Choosing one over non-example, non-empty source opens an `AlertDialog` naming the target: "Replace your code with 'nextTick vs Promise'?", with Cancel as the default focus. Choosing one over an example's source replaces it with no dialog.
- **The editor** is CodeMirror 6, loaded lazily behind a fixed-height skeleton (D6), with `EditorView.cspNonce` set (D1). It shows the current-tick line as a solid green-tinted line and the hovered line as an outline (`cm-sl-current`, `cm-sl-hovered`, `data-sl-highlight`).
- **Diagnostics sit next to their cause:** a wavy underline at the range, a gutter marker (`CircleX` for errors, `TriangleAlert` for warnings), and a hover tooltip with the message, the hint, and for excluded features a "Why isn't this supported?" link to `/docs/subset#<code>` (D7).
- **`ProblemsList`** sits under the editor as a collapsible strip headed "Problems (n)". Each row shows the icon, the message, `line:col` in mono, and the docs link. Activating a row moves the editor cursor to the range. With zero problems it collapses to its header reading "No problems".

### 10.2 Code panes (right): AST | Bytecode | Machine Code

- **Shared anatomy.** A tab strip with the truth badge on the right (§8), then one read-only CodeMirror document, lazy, behind a fixed-height skeleton (D6). Hovering a line outlines it and outlines the mapped lines in every other pane; the playback position is the solid highlight in every pane.
- **AST.** The indented tree as text (node type, name, and range in muted mono), with the scope chain as a compact section beneath it: each scope with its kind and bindings, hoisted and TDZ bindings marked by a text tag, not by color alone.
- **Bytecode.** The `--print-bytecode`-style listing: offset gutter, opcode, operands, and feedback slots as plain text (`[0]`) in Phase 6. Function headers separate each function's listing.
- **Machine Code.** The assembly with two toolbar toggles: **AT&T | Intel** (D5) and **Asm | Hex | Binary**. Hex and Binary show the bytes as a column beside the instruction they encode, never instead of it. Long programs stay smooth because CodeMirror virtualizes.

### 10.3 Bottom panel

- **Header row:** tabs **Event Loop (2D) | V8 Internals | Hardware (3D)**, the active tab's truth badge, and a collapse button (`ChevronDown`/`ChevronUp`, `aria-expanded`, `aria-controls`).
- **Below the tab content, always visible:** the playback bar (§10.4) and the narration line (§10.6).

### 10.4 Playback bar

Three rows, top to bottom, all of fixed height so playback never shifts the layout:

1. **The scrubber** spans the full width (§10.5).
2. **The controls row:**
   - left: icon buttons **First** (`ChevronsLeft`), **Previous job** (`SkipBack`), **Step back** (`StepBack`), **Play/Pause** (`Play`/`Pause`, the one primary green button), **Step forward** (`StepForward`), **Next job** (`SkipForward`), **Last** (`ChevronsRight`). Each has an `aria-label`, a tooltip and its `Kbd` shortcut.
   - middle: the speed toggle group over `0.25× 0.5× 1× 2× 4× 8×`, with the current mode's default selected on a mode switch.
   - right: `Tick n / N` in mono tabular numerals, the current phase as a labelled chip (role color plus text: "nextTick", "microtasks", "timers", "check", "main script", "exit"), and a reserved slot for the `StopNotice`.
3. **The narration line** (§10.6).

- **At 375 px** the controls row keeps Step back, Play/Pause and Step forward, plus Previous and Next job, at 44 px each with 8 px gaps. First, Last and the speed group move into a "More playback" popover (`Ellipsis`). `Tick n / N` stays visible.
- **At length 0** every control is disabled, and the scrubber shows an empty track.

### 10.5 Scrubber and markers

- **The track** is a `role="slider"` with `aria-valuetext="Tick n, <phase>"`. It owns its arrows, Home and End (ADR-047), and its thumb is positioned through a ref (D1). The played portion of the track is tinted with `bg-current` at low opacity; the thumb is the only solid green.
- **Job markers** sit in a lane under the track: one short mark per job boundary (D4), colored by phase and also shaped by it, so color is never the only signal. Microtask: filled violet. nextTick: hollow violet outline. Timers and check: amber, with the phase name in the tooltip. Script and exit: neutral.
- **Warning markers** sit in a lane above the track: a yellow `TriangleAlert` at the first tick of each fidelity warning, with the message in a tooltip and as accessible text.
- Markers never move the thumb on hover; clicking a marker seeks to it.

### 10.6 Narration line and stop notice

- **`NarrationLine`.** The current tick's narration in an `aria-live="polite"` region, in the friendly-coach voice, at a fixed height of two lines with internal scrolling, so long narrations never shift the layout. Inline code in the narration renders in mono.
- **`StopNotice`.** When `compile.stop` is set: a yellow `OctagonPause` chip "Simulation limit reached — real Node would continue", plus the limit in words ("tick limit: 5,000 ticks"). It is a warning, never styled as a JS error, and it lives in the controls row's reserved slot so it never shifts the layout. An `unsupported` stop shows its reason with the same styling and a docs link where one exists.

### 10.7 2D Event Loop

- **Two ownership groups, each labelled in text**, so the boundary is taught on screen:
  - **"V8"**: the Call Stack and the Microtask queue, captioned "owned by V8".
  - **"Node / libuv"**: the phase ring, the nextTick queue, the Timers queue, the Check (setImmediate) queue and Host APIs, captioned "owned by Node/libuv".
- **At ≥ 1280 px** the V8 group is on the left (~35%) and the Node group on the right. The Call Stack is vertical, newest frame on top. Queues are horizontal lanes, read left to right, with the head marked "next". The phase ring sits at the left of the Node group, and Host APIs at its foot.
- **Regions.** Each has a heading with its icon, its name and a count, plus `aria-label` and the `data-testid` values `region-call-stack`, `region-microtask`, `region-nexttick`, `region-timers`, `region-check` and `region-host`. A lane shows at most 12 chips, then a "+N more" chip.
- **Chips (`TaskChip`).** The label in mono on `bg-card`, with a role-colored edge (an outline for nextTick), and the origin (where it was scheduled) in a tooltip. Host API entries add their kind and delay as text ("setTimeout · 0 ms"). A chip named in a current nondeterminism warning adds a yellow "Order not guaranteed" chip.
- **The phase ring.** timers → pending → poll → check → close, the current phase in green with `aria-current="step"` and its name in text. Between phases it reads "running the main script" or "draining nextTicks/microtasks", from the tick's `phase`. At 375 px it becomes a five-step row.
- **Motion.** Tasks share `layoutId` `task-<id>`, so a callback visibly travels between regions. Frames enter with `spring { stiffness: 500, damping: 32 }` (no overshoot) and leave with a fade-up exit inside `AnimatePresence mode="popLayout"`. Only `transform` and `opacity` animate. Under reduced motion every change is instant (`MotionConfig reducedMotion="user"`). Motion mounts on the client only (D1).

### 10.8 Console

- **Placement.** The right column of the Event Loop tab at ≥ 1280 px, a strip under the 2D view from 375 to 1279 px. It is part of the Event Loop tab because output order is what the loop explains.
- **Content.** Header "Console" with its Exact badge. Lines render as text nodes in mono: stdout plain, stderr in `text-destructive` with a "stderr" label, never HTML (`data-testid="console"`). At the end of a run, the exit code shows as a final muted line ("exit code 0").
- **Predict first** (Interview prep): the console body shows "Predict the output, then reveal" with a **Reveal** button (`Eye`) until Reveal is pressed or the last tick is reached. It hides again on a new job.

### 10.9 V8 Internals and Hardware placeholders

- **V8 Internals** (`PlaceholderPanel`): names, in two or three sentences, what Phase 7 adds here (the frame inspector, the hidden-class graph, the IC table, the elements-kind lattice, the heap strip, the tier timeline) and the truth level each will carry. No fake data, no "coming soon" filler.
- **Hardware (3D)**: the same treatment, with its Illustrative badge, naming the CPU board and the 2D fallback that Phase 7 builds. It is hidden below 768 px.

### 10.10 Command palette

- Opens on `⌘K`/`Ctrl+K` (also from inside the editor) and from the top bar's "⌘K" button. It is a portalled dialog with an input and grouped commands: **Run**, **Examples ›**, **Go to tick…**, **Toggle 3D** (selects the Hardware tab), **Show stripped JS** (a dialog with the stripped source as a read-only CodeMirror document), **Theme**, **Mode ›**. Each command shows its shortcut where it has one.
- "Go to tick…" takes a 1-based number and clamps it, with the valid range as the input's hint.

### 10.11 Onboarding coach marks

- Three dismissible steps, anchored to their targets and portalled: (1) the editor and the Examples menu, (2) the code panes and hover sync, (3) Play and the scrubber. Each has Next, Back where it applies, "Skip tour", and Esc to dismiss, with "1 of 3" progress in text.
- They show once per device (`localStorage["sl_onboarded"]`, every read and write wrapped in `try`/`catch`). They never cover the control they describe, and in the stacked layout each step first switches to the segment that holds its target.

### 10.12 `/docs/subset` (Read mode)

- A 65–75ch measure, server-rendered, with the limits table and the excluded-construct table, each row with an `id={code}` anchor and the reason in plain words. Linked from every excluded-feature diagnostic (D7). The targeted row is visibly marked on arrival (`:target`), with no motion.

### 10.13 Accessibility

- Every control is reachable by keyboard with a visible focus ring (`ring`). Tab order follows the regions: top bar, editor, code panes, bottom panel, playback bar.
- Global shortcuts follow ADR-047: widgets own their keys, and Space on a button activates that button only.
- The narration is the one `aria-live="polite"` region; the status is `role="status"`. No other region announces per tick, so screen readers are not flooded during playback.
- Color is never the only signal (labels, icons, shapes everywhere). The axe pass (WCAG 2.2 AA) runs in both themes and with the palette open.

## 11. States per region

Statuses come from the store: `idle`, `compiling`, `simulating`, `ready`, `refused`, `failed`. On a new job, previous views stay visible until the new `compiled` replaces them in one step (ADR-041); skeletons appear only when a region has nothing to show yet. That avoids flashing on every keystroke.

| Region | Empty | Loading | Refused | Failed |
|---|---|---|---|---|
| **Editor** | An inline empty state that teaches: "Start with an example", listing the ten examples as buttons with their blurbs. | A fixed-height CodeMirror skeleton (gutter plus line bars) while the chunk loads. | The source stays editable, with inline diagnostics and the Problems list open. The status reads "Refused: see Problems". | An error strip above Problems: what happened (the message) and what to try ("Edit the code or choose Run to try again"). The source is never lost. |
| **Code panes** | "Nothing compiled yet. Pick an example or type a program." | A fixed-height skeleton until the first `compiled`; afterwards the previous view stays until it is replaced. | Any view the compiler still produced is shown; a pane with none reads "No bytecode: the program was refused. Fix the first problem to see it.", linking to that problem. | "This view couldn't be built: <message>." with the same "try again" hint. |
| **Event Loop (2D)** | Regions drawn empty, with the teaching empty state on each queue ("empty: the loop moves on") and "Press Play to watch Node run your program". | While simulating: region outlines as skeletons, the status "Simulating…", playback disabled. | "Nothing to run yet: fix the problem in the editor first." The regions are not drawn. | "The run couldn't finish: <message>." |
| **Console** | Before the first print: "Nothing printed yet". At the end of a silent run: "This program printed nothing." | Skeleton lines while simulating. | Hidden behind the 2D view's refused message. | The failure message, with no partial output presented as real. |
| **Playback bar** | All controls disabled; an empty track. | Disabled, with a skeleton track while simulating. | Disabled. | Disabled. |
| **Narration** | "Pick an example or press Play: I'll explain each step." | Blank at fixed height (no layout shift). | "This program was refused before it could run. The Problems list says why and what to try." | The failure message in the coach's voice. |

**Also material:**
- **Limit reached:** the run ends at its last recorded tick, the `StopNotice` shows, and the narration of the final tick says real Node would continue.
- **Nondeterministic run:** the verified badge chip, a warning marker on the scrubber, and the warning chip on the affected tasks.
- **Uncaught error** (the "uncaught TypeError" example): stderr in red with its label, and a non-zero exit code. This is the program's real, Exact output, not a UI error, and it never shares the failed state's styling.

## 12. Motion

- UI transitions take 150–250 ms (`--duration-enter: 220ms`, `--duration-exit: 150ms`, `--ease-out-quint`), and exits are faster than entrances.
- Motion conveys state only: a task moving, a frame pushed or popped, a panel opening. There is no page-load sequence, no stagger, no overshoot, and no GSAP.
- Under `prefers-reduced-motion`, every change is instant (Task 13 checks that no Web Animation runs).

## 13. Constraints that shape the build

- **CSP (D1, ADR-012).** No SSR `style=`. Every injected `<style>` carries the nonce. Motion, the resizable split and the scrubber thumb mount on the client or style through refs.
- **Lazy panes (D6).** Every CodeMirror pane loads with `next/dynamic(…, { ssr: false })` behind a fixed-height skeleton, and so does Motion.
- **Bundle.** `/playground` first-load JS stays at or under 250 KB gz (ADR-040; it was about 232 KB before this phase). This is why the panes, the palette's dialog content and the 2D view load lazily.
- **Reads and writes.** Components read through Phase 5's hooks and write only through store actions (ADR-046). Per-tick updates re-render only the subscribers of the changed slice.
- **Never execute user code.** Source and output render as text or as CodeMirror documents, never as HTML.

## 14. Judgement calls and conflicts

**Conflicts between PROMPT §8, the ADRs and the plan (the plan and ADRs win):**

1. **The Machine Code bytes badge.** §3.2 gives machine-code bytes the level "Exact encoding of the shown assembly", but the plan's constraint says badges use the exact `TRUTH_TOOLTIPS` text, whose Exact tooltip reads "byte-identical to real Node on the pinned version". That is false for bytes that encode an illustrative assembly. **Proposal:** in Hex/Binary mode, show a quiet "Exact encoding" badge (`Check`) whose tooltip is its own one sentence ("Exact encoding: these are the real x64 bytes for the assembly shown, checked against llvm-mc; the assembly itself is illustrative."), added beside `TRUTH_TOOLTIPS` in Task 6 or 7. The owner should confirm.
2. **3D on mobile.** §8.3 says 3D is "off by default" on mobile; the plan's Task 8 hides the Hardware tab on mobile. Phase 6 only has a placeholder there, so hiding it costs nothing now. Phase 7 should revisit this: "off by default" suggests an opt-in, not removal.
3. **Resizable panes.** §8.3 names shadcn `Resizable`; D8 allows an in-house `ResizableSplit` if the shadcn one emits SSR `style=`. The brief specifies the behaviour, which either satisfies.
4. **Machine Code toggles.** §8.3 names only a Hex/Binary toggle; D5 adds AT&T/Intel. Both are specified.
5. **Feedback-slot links.** §8.3's bytecode slots "link to the IC view", which does not exist until Phase 7. They render as plain text (plan, Open risks).
6. **Breakpoints.** §8.3 defines ≥ 1280 px and "narrower screens"; the plan stacks below 1024 px. The brief defines 1024–1279 px as the three-region layout with the console moved under the 2D view.
7. **"Toggle 3D"** (§8.2) has no 3D view to toggle in Phase 6. It selects the Hardware tab, as the plan says, and shows the placeholder.

**Judgement calls (not dictated by any source):**

- **A top bar** for the status, mode control, theme toggle and palette button, since §8.3 places none of these.
- **The console's location** in the Event Loop tab (a side column at ≥ 1280 px, a strip below that), since §8.3 does not place it.
- **The playback bar and narration stay visible** when the bottom region is collapsed, and are pinned in every segment of the stacked layout.
- **Previous views stay visible while recompiling**, with skeletons only on first load, to avoid flashing on each debounced keystroke.
- **Marker shapes** (filled, hollow, neutral) as the non-color signal on the scrubber, and `Check` reserved for the Exact and verified badges.
- **Mode switches apply the mode's speed and density defaults**, but never override an explicit theme choice.
- **Predict first gates the console only.** The narration does not quote console output, so it stays live; Task 12 should confirm that no narration string spoils the output before Reveal.
