# V8 Internals and Hardware shape brief (Phase 7)

Output of `impeccable shape` for the **V8 Internals** and **Hardware** bottom-panel tabs of `/playground`, in **Operate** mode. Inputs: `PRODUCT.md`, `DESIGN.md`, PROMPT §8.3 ("V8 Internals view", "3D Hardware board (R3F)", "Accessibility"), the Phase 6 brief `docs/design/playground-shape.md`, and the Phase 7 plan (`docs/superpowers/plans/2026-10-26-phase-7-v8-internals-3d-hardware.md`: Global Constraints, D1 to D7, the truth badge table, Review Focus). Where they conflict, the ADRs and the plan win; every such case is in §11.

This brief fixes layout, hierarchy, states and copy. It names tokens but sets no CSS values, and it writes no code.

## Owner decisions

Status: **answered by the owner on 2026-10-26** (Task 1 Step 2). The owner took the recommended default on all four, so D5 and D7 in the plan stand unchanged and the Task 10 gate is modern first-load JS = 214.2 KB ± 0.5 KB. Each item gives the default and why.

| # | Question | Recommended default | Why |
|---|---|---|---|
| 1 | **D7: are the predict-first masking rules right?** (Interview prep, before Reveal: the frame inspector shows string values as `"…"` and object previews as `{…}`; everything else stays visible.) | **Confirm D7 as written.** Mask strings and object previews only. Keep Smi, HeapNumber and Oddball values visible. | Strings are what the ordering questions print, so they are the real leak. A number in the accumulator leaks no more than the current-line highlight, which ADR-061 keeps live, and masking numbers would hide the Smi tagging (`5` → `0xa`) that the inspector exists to teach. The hardware board shows registers as hex words and pointers, so it needs no masking. Masked cells read `"…"` with the accessible text "string, hidden until you reveal". |
| 2 | **D5: 3D or SVG by default on desktop?** | **3D by default at 768 px and up when WebGL works; SVG under 768 px, without WebGL, after a context loss, or when the learner chose 2D** (D5 as written). | The tab promises the 3D board, and the board itself adds nothing to first load either way (lazy, ADR-062). The SVG board carries the same data and stays one click away. The learner's choice persists in `sl_hw_view`. Reduced motion keeps 3D but makes pulses and flashes instant (Global Constraints). |
| 3 | **ADR-062: does the budget count the `noModule` chunk?** This sets the Task 10 gate. | **No. The budget is the modern-browser first load: 214.2 KB gz against 250 KB.** The Task 10 gate is "modern first-load JS = 214.2 KB ± 0.5 KB". The `noModule` total (252.8 KB) is recorded alongside it for information. | Only browsers without ES modules download the `noModule` polyfill chunk, and our learners' browsers support modules. The polyfills come from Next, not from us, so counting them penalizes nothing we control. Phase 7 was meant to add 0 KB (it ended at +0.8 KB, ADR-074), so the answer changes only which number the gate reads and Phase 9's enforcement. |
| 4 | **Orbit controls (drag to rotate) or a fixed camera?** | **A fixed camera, with no orbit, zoom or pan.** | Labels stay legible at one known angle, and positions never move (Operate: stable positions). Dragging inside a scrollable bottom panel fights page and touch scrolling. A drag-only control gives keyboard users nothing, and every reading of the board is already available as text. The board is Illustrative, so a free camera adds spectacle, not understanding. If the owner wants a second angle later, two keyboard-operable presets ("Front", "Three-quarter") are cheaper than orbit. |

**Owner answers:** 1 confirmed as written; 2 3D by default on desktop; 3 the `noModule` chunk is not counted; 4 fixed camera.

**Controller rulings on the open points (§12, §14):** the 16-cell code strip (208 cells in all) and the two new tokens `--bus-read` and `--bus-write` are accepted as proposed, subject to Task 8 confirming them against the contrast test. Sizing the grid from container height is binding on Tasks 5, 6 and 10.

## 1. Job, audience, mode

- **Who:** the same learners as Phase 6 (Self-study, Interview prep, Classroom). These two tabs are for the second question: after "why that order?" comes "what did V8 and the CPU actually hold at this tick?"
- **Mode: Operate.** Dense, stable, scannable, keyboard-first. The brand lives in exact names (`Map#3`, `PACKED_SMI_ELEMENTS`, `rax = accumulator`), honest badges, and one green "current" signal.
- **Outcome:** on "hidden classes: same shape vs different order", the learner steps to the last `console.log` and sees two `Map` branches diverge in the graph, with an IC row going polymorphic. On "elements kinds", they see the lattice move one way only. On "recursive factorial", they watch `rax` and the stack region fill on the board.
- **Anti-goals.** The design fails if a Modeled or Illustrative panel looks as authoritative as a Verified one; if anything shifts during playback (CLS < 0.01); if a sub-tab or panel switches by itself while playing; if the board looks like a benchmark or a measurement; or if the interview answer leaks.

## 2. Shared rules for both tabs

- **Surfaces.** `bg-panel` is the tab body, `bg-card` holds panel bodies, chips and nodes, and `border-border` draws the dividers. There is no raw hex. Panel headers are one fixed-height row: the title in `text-xs` sans (sentence case), a muted count, and the badge at the right.
- **One "current" signal.** Green (`current`) marks only what *is current or changed on this tick*: the current register rows that changed, the current Map, the IC row whose state changed, the current elements kind, the playhead in the tier timeline, the ALU and register flashes. It always comes with text ("current", `aria-current`, or a "changed this tick" label for screen readers).
- **Hover sync.** Hovering a `Map#n` chip anywhere (IC table, frame inspector object preview, table view) outlines that node in the graph, using the Phase 6 outline convention. The solid fill stays reserved for current.
- **Nothing switches by itself.** Sub-tabs, disclosures and the board mode change only on a learner action. The single exception is the bytecode feedback-slot link (§6), which is itself a learner action.
- **Sizes are fixed per layout.** Panel heights depend on the container, which does not change during playback, so ticks never reflow the grid. Lists scroll inside their panel.
- **Loading.** Each panel shows a fixed-height skeleton in its own shape (table rows, tree nodes, lattice cells, lanes, tracks, board outline) while its lazy chunk loads or the job simulates. On a new job, the previous content stays until the new `simulated` replaces it in one step (ADR-041).
- **Refused or failed run.** Each tab shows one message in place of its panels: "Nothing to inspect yet: fix the problem in the editor first." (refused) or "The run couldn't finish: <message>." (failed).

## 3. V8 Internals: layout

### Reading order (DOM, Tab order and visual order agree)

1. **Frame inspector**: what V8 holds right now.
2. **Hidden-class graph**: the shapes of the objects it works on.
3. **IC table**: how the code's property accesses saw those shapes.
4. **Elements-kind lattice**: the same idea for arrays.
5. **Heap strip**: where those objects live.
6. **Tier timeline**: the long view across the whole run.

This goes from the current instruction outward, from one tick to the whole timeline.

### The binding constraint is height, not width

At the default split (bottom 40%), the tab content is about **150 px tall at 1280×800** and about **190 px at 1440×900**, once the tab strip and the playback bar are taken out. Six panels cannot all sit open at that height. The grid therefore adapts to the **tab content's container size** (container queries on width and height), not to the viewport width alone. The default viewport sizes land in the "short" tier, which must be good on its own. The tab never resizes the split automatically, because that would move the editor and panes. Dragging the divider up unlocks the taller tiers.

### ≥ 1280 px (container width 1024 to 1399 px)

Three columns:

| Column | Width | Short (H < 300) | Tall (H ≥ 300) |
|---|---|---|---|
| A | ~26% (min 240 px) | Frame inspector, always open | same |
| B | ~44% | Sub-tabs **Hidden classes \| Inline caches \| Tiers**; one shown, default Hidden classes | Hidden-class graph on top (~60%), with sub-tabs **Inline caches \| Tiers** below |
| C | ~30% | Sub-tabs **Elements \| Heap**; one shown, default Elements | Elements lattice over Heap strip, both open |

### ≥ 1440 px (container width ≥ 1400 px)

The same three columns. Column C stacks **Elements lattice over Heap strip** from H ≥ 170 px, so at 1440×900 the default shows the frame, one column-B panel, the lattice and the heap at once. Column B stays tabbed below H 300.

### Collapse and overflow

- Panels inside a sub-tab group are not collapsed but hidden: the sub-tab strip lists each one with a one-line summary in its tooltip and accessible name (below).
- **Summaries** (also used at 375 px): Hidden classes "6 Maps · current Map#4"; Inline caches "12 slots · 2 polymorphic"; Tiers "3 functions · 1 deopt"; Elements "PACKED_DOUBLE_ELEMENTS"; Heap "young 18% · old 4% · last GC: scavenge".
- The sub-tab strip has its own truth badge at its right, for the visible panel, as Phase 6's region headers do.
- When H < 220 px, a muted line under the column-B tabs reads, once per session: "Drag the divider above the playback bar up to see more panels at once."

### 768 px (Run segment, stacked)

The Run segment gives the tab most of the viewport height, so the tab is **one scrolling column** of disclosure sections, all expanded, in reading order. Elements and Heap sit **side by side as one row** (both are short). The graph and the tier timeline use the full width.

### 375 px

- One column, as an **accordion** in reading order. The **frame inspector is expanded** and the rest are collapsed to a header row showing their summary. Each header is a button with `aria-expanded` and a 44 px target.
- The hidden-class graph opens in **Table** view (the graph scrolls sideways inside its panel if chosen).
- The lattice turns vertical: a PACKED column and a HOLEY column of three, with DICTIONARY below.
- Heap lanes put their labels above the cells.
- Tier tracks keep the full width, with function names above each track.

## 4. Frame inspector

- **Header:** "Frame" · the function name in mono · "offset 14" · "context #2" · badge **Verified model** (`FlaskConical`). A one-line muted caption under it reads: "Values are exact; the tagging is our verified model." (ADR-039)
- **Body:** a `<table>` in mono with tabular numerals. Columns: **Register** (`acc`, then `r0..rn`) | **Value** | **Tag** | **Tagged word**. The accumulator row is pinned at the top and the rest scroll.
- **Tag:** text plus an icon, never color alone: `Smi` (`Hash`), `HeapObject` (`Box`), `Oddball` (`CircleDashed`), `internal` (`Lock`). The tagged word shows only for a Smi (`0xa`) and is `—` otherwise.
- **Value:** a Smi is its number; a HeapNumber is its `text`; a string is quoted; an Oddball is its name (`undefined`, `the_hole`); an object is its `preview` plus a `Map#n` chip (with hover sync); internal is "context" or "message".
- **Change:** a row whose value changed this tick gets the green outline and the screen-reader text "changed this tick".
- **Predict first (D7):** strings show `"…"` and object previews `{…}` until Reveal or the last tick.
- **Empty states:**
  - Before any run: "Registers appear when your code runs. Press Play or step forward."
  - No frame on this tick: "No JavaScript frame right now: the call stack is empty while Node's loop picks the next task."
  - A frame with no `r` registers: an acc row, then "This function needs only the accumulator."

## 5. Hidden-class graph

- **Header:** "Hidden classes" · "n Maps" · a **Graph | Table** toggle group (`Network` / `Table2`) · badge **Verified model**.
- **Graph:** a **horizontal tidy tree**, with the root Map at the left and transitions growing to the right, to suit wide, short panels. Node: a `bg-card` box with `Map#n` in mono and "k fields" in muted text. Edge: a one-way arrow labelled with the added key in mono (`x`, `y`).
  - **Current Map:** green outline, a tinted fill and `aria-current="true"`, plus the word "current" when there is room.
  - **Dictionary:** dashed border plus the label "dictionary".
  - **Deprecated:** struck-through id plus the label "deprecated".
  - **Over 128 Maps:** a trailing muted node "+N more Maps" (Review Focus 3).
  - The panel scrolls in both directions. On a tick change it brings the current node into view only if it left the viewport (`nearest`), and it does so instantly under reduced motion.
  - **Motion:** a new node fades and slides in over 220 ms (opacity and transform only).
- **Table:** columns Map | Parent | Added key | Fields | Flags ("dictionary", "deprecated", "current"). It is the text alternative and has the same ids as the graph.
- **Empty:** "No objects yet: hidden classes appear when your code creates one."

## 6. IC table

- **Header:** "Inline caches" · "n slots" · panel badge = **the weakest level among its rows** (Modeled if any row is Modeled, else Verified model).
- **Rows** (the `icRows` order): Function (mono, truncated, full name in the tooltip) | Slot `[n]` | Kind (`LoadProperty` …) | State | Maps seen (`Map#n` chips, with hover sync) | a per-row badge, icon only (`FlaskConical` or `Gauge`), focusable, with its `TRUTH_TOOLTIPS` text.
- **State as words:** "uninitialized" (muted), "monomorphic", "polymorphic (k)", "megamorphic". A state that changed this tick gets the green outline and "changed this tick".
- **Slot link (§8.3):** clicking `[n]` in the Bytecode pane opens the V8 Internals tab, switches column B (or the 375 px accordion) to Inline caches, marks the row `aria-selected="true"`, and scrolls it into view. At 768 px and below it also switches the segment to Run.
- **Over 50 rows:** a "Show all N" button after row 50.
- **Empty:** "No inline caches yet: they appear once a function with property accesses or calls has run."

## 7. Elements-kind lattice

- **Header:** "Elements kinds" · "array object #12 (changed last)" · badge **Verified model**.
- **Layout:** an `<ol>` of 7 `<li>` nodes drawn over an SVG of arrows, in fixed positions.

  ```
  PACKED  SMI → DOUBLE → ELEMENTS
           ↓      ↓        ↓
  HOLEY   SMI → DOUBLE → ELEMENTS → DICTIONARY
  ```

  Each node shows its short name visibly and its full name (`PACKED_SMI_ELEMENTS`) in `aria-label` and the tooltip. Every arrow is one-way with an arrowhead, and the `*→DICTIONARY` edges join at the DICTIONARY node.
- **Current kind:** green fill, `aria-current="true"`, and the word "current".
- **Unreachable kinds** (no way back from the current one): dimmed, with "(no way back)" as accessible text on each node and once as a visible legend under the lattice: "Dimmed: no way back from the current kind."
- **Empty:** "No arrays yet: create one and its elements kind lights up here. Kinds only ever move one way, toward the more general."

## 8. Heap strip

- **Header:** "Heap" · "young 18% · old 4%" · badge **Illustrative** (`PencilLine`).
- **Body:** three labelled lanes of 64 cells each: "Young · from", "Young · to", "Old". Filled cells use `muted-foreground` and empty ones `secondary`. At the right of each lane, the estimate in mono: "12 KB / 1 MB".
- **GC:** on a tick whose `lastGc` is new, a chip at the lane start reads "scavenge" or "mark-compact" (`Recycle` icon), with freed, survived and promoted counts in its tooltip. Surviving cells slide to the to-space, and promoted cells slide to Old with the label "promoted", in 220 ms (instant under reduced motion).
- **Caption, always visible:** "Sizes are estimates; GC never changes your program's output."
- **Empty:** "Nothing allocated yet." With no GC so far, the caption adds: "No garbage collection so far: small programs often finish without one."

## 9. Tier timeline

- **Header:** "V8 would typically tier up here" · "n functions" · badge **Modeled** (`Gauge`, dashed outline).
- **Body:** one row per function. The function name (mono, truncated) sits in a fixed left column, then a track along the tick axis from 0 to N.
  - **Segments** by tier use a neutral ramp (Ignition `secondary`, Sparkplug and Maglev in two intermediate steps of `muted-foreground`, TurboFan `foreground`), never hue alone. Each segment carries its initial (I, S, M, T) when it is at least 16 px wide, and a legend row spells out "Ignition → Sparkplug → Maglev → TurboFan".
  - **Deopt:** a red (`destructive`) marker with the `ArrowDownToLine` icon. Its tooltip is `DEOPTIMIZE_REASON_MESSAGES[reason]`, and it is focusable.
  - **Playhead:** a 1 px `current` line at `playback.index` across all rows.
- **Over 50 rows:** "Show all N".
- **Empty:** "No function got hot enough to tier up: V8 would typically keep running it in Ignition, the bytecode interpreter."

## 10. Hardware board (3D and SVG)

### Tab chrome

- **Region header:** the tab's badge **Illustrative** (`PencilLine`), as in Phase 6.
- **Toolbar row** (fixed height, above the board):
  - left: a **3D | 2D** toggle (`aria-pressed`) and the fallback notice when `reason` is not `user`: "3D unavailable; showing the 2D board" (no WebGL or context lost), or "2D board on small screens" (narrow)
  - middle: the **readout**, which is the current instruction in mono, in the Machine Code pane's syntax, then `rax=0x… rsi=0x…`. This is the same string as the canvas `aria-label`, it stays legible at any board size, and it is the text the SVG board shares.
  - right: the legend: "fetch · read · write" as pulse swatches with arrows, then "hit" (a filled `current` dot) and "miss" (a hollow `destructive` dot). `Check` is not used here, because it is reserved.

### Composition: wide (container aspect ≥ 1.6; every desktop default)

Data flows left to right, and the camera is fixed:

```
┌──────────────── CPU die (card on secondary substrate) ────────────────┐            ┌──── RAM ────┐
│ Register bank 2×8      ALU         L1  8 lines (2×4)   L2 32 lines (4×8) │ ══ bus ══▶ │ code   ▭▭▭  │
│ rax  accumulator      [add]        ▢▢▢▢                ▢▢▢▢▢▢▢▢          │            │ stack  8×8  │
│ rcx  …  r8 return2 …   ▽           ▢▢▢▢                …                 │            │ young  from│to│
│ (16 GPRs, encoding order)                                              │            │ old    8×8  │
└────────────────────────────────────────────────────────────────────────┘            └────────────┘
```

- **Die:** one slab in `card` on a `secondary` substrate, with `border` edges and the label "CPU (x86-64)".
- **Register bank:** 16 tiles in two rows of 8 (`rax rcx rdx rbx rsp rbp rsi rdi`, then `r8`–`r15`). Each tile shows the name (mono), the V8 role in muted sans from `RegisterRoles` (`accumulator`, `context`, `JS function`, `stack pointer`, `frame pointer`, `bytecode offset`, `bytecode array`, `dispatch table`, `root`, `cage base`, `scratch`), and the value in hex (mono). A value redraws into its tile's texture only when it changes. A changed register flashes `current` for 150 ms.
- **ALU:** a raised trapezoid between the bank and the caches, labelled "ALU", with its op (`add`, `cmp` …). It is lit `current` while `hw.alu` is non-null, and reads "idle" otherwise.
- **L1 and L2** sit on the die (as on modern CPUs), labelled "L1 · 8 lines" and "L2 · 32 lines". The served cell flashes "hit" (`current`) or "miss" (`destructive`), and on a miss the RAM cell lights too.
- **Buses:** an internal bus from the bank to the ALU to L1, and one memory bus from the die's right edge to a RAM spine that branches to each region. A pulse travels in the access's direction (fetch and read toward the die, write toward RAM), with an arrowhead, so direction is never color-only.
- **RAM:** a module labelled "RAM" with regions stacked top to bottom: **code** (a 16-cell strip; see §11), **stack**, **young gen** (split from|to), **old gen**, each 8×8 cells and each labelled. The fill comes from call-stack depth and `heapStrip`.
- **Camera:** fixed, orthographic, a three-quarter view from above (about 25° elevation), so text stays square-on and readable. The camera fits the board's bounds on container resize only, never per tick. Lighting is one ambient plus one directional, with no shadows.
- **Below about 160 px of board height**, register tiles drop the value line, and the readout carries it.

### Composition: tall (container aspect < 1.6; the 768 px Run segment and 375 px)

The die is on top and RAM below, with the memory bus running vertically. The register bank is 4×4, L1 and L2 sit beside it, and the RAM regions form a 2×2 grid (code and stack, then young and old). The same element set and labels apply.

### SVG board

The same two compositions, flat, with the same ids, labels and legend. Values are SVG `<text>` with tabular numerals, so screen readers read them directly. Fills and classes change through refs (no React commits per tick). It uses token-backed CSS classes and no inline `style`.

### Breakpoints

| Width | Board |
|---|---|
| ≥ 1280 px | Wide composition, 3D by default (owner decision 2), the toolbar in one row |
| 768 to 1023 px | Tall composition in the Run segment, 3D by default |
| 375 to 767 px | Tall composition, **SVG** (D5). The tab is now visible at every width (Task 10). The 3D toggle stays offered, with the notice "2D board on small screens" when it is not chosen. The toolbar wraps: the toggle and legend on one row, the readout on a second. |

### Empty states

- Before any run: "Nothing to execute yet. Press Play and the board follows the Machine Code pane, one instruction at a time."
- A tick with no machine state (`machineStateAt` is `null`): the board dims to its idle state and the readout reads "No baseline code on this tick: Node is between tasks, so the CPU waits."

## 11. Truth badge placement

| Panel | Badge | Where |
|---|---|---|
| V8 Internals tab (region header) | none | Each panel carries its own, as the Phase 6 placeholder did |
| Frame inspector | Verified model (`FlaskConical`) + the "values are exact" caption | Right of the panel header |
| Hidden-class graph | Verified model | Right of the panel header (or of the column-B sub-tab strip when tabbed) |
| IC table | Weakest row level (panel); Verified model or Modeled (per row) | Panel header right; the last column of each row |
| Elements-kind lattice | Verified model | Panel header right (or the column-C sub-tab strip) |
| Heap strip | Illustrative (`PencilLine`) + the estimates caption | Panel header right |
| Tier timeline | Modeled (`Gauge`, dashed) | Panel header right, next to "V8 would typically tier up here" |
| Hardware tab (3D and SVG) | Illustrative | Region header right; not repeated on the board |

All badges use the exact `TRUTH_TOOLTIPS` text, are focusable, and look as `DESIGN.md` specifies.

## 12. Tokens and icons

- **Existing tokens only:** `background`, `panel`, `card`, `secondary`, `border`, `foreground`, `muted-foreground`, `current`, `ring`, `destructive`, `warning`. The event-loop roles (`microtask`, `macrotask`, `webapi`) are **not** used on these tabs, so their meanings stay intact.
- **New tokens flagged (Task 8 decides; each needs both themes and `tests/tooling/contrast.test.ts`, 3:1 for graphics):**
  - `--bus-read`: a blue (no blue exists yet; it is clear of cyan `webapi`)
  - `--bus-write`: a pink, kept apart from `destructive` by the write arrow direction and the legend label

  A fetch pulse uses `muted-foreground`. If the owner prefers no new tokens, read and write can share one `--bus` color and differ by direction and a dashed write stroke.
- **Icons (all present in lucide-react):** `Hash`, `Box`, `CircleDashed`, `Lock` (value tags), `Network` and `Table2` (graph toggle), `Recycle` (GC), `ArrowDownToLine` (deopt), `Cpu` and `MemoryStick` (board labels in the SVG), plus the badge icons. `Check` stays reserved for Exact and verified.

## 13. Accessibility

- Tab order: tab strip → column A → column B's sub-tabs and panel → column C → playback bar. Sub-tabs use roving tabindex with arrow keys and own their keys (ADR-047). They are not global shortcuts.
- Text alternatives: the graph's Table view; the lattice as `<ol>`/`<li>` with `aria-current`; the frame and IC data as real `<table>`s; the canvas as `role="img"` with an `aria-label` set through a ref; the SVG board's values as `<text>`.
- No panel announces per tick. The narration stays the only live region (DESIGN.md).
- Every color carries a word or icon: current, changed, hit or miss, dictionary, deprecated, deopt, the tier initials, and the bus direction.
- Targets: 44×44 px on coarse pointers (accordion headers, sub-tabs, "Show all", the toggles), and at least 24×24 px on fine pointers.
- The axe pass runs on both tabs, in both themes, at 1280 and 375 px.

## 14. Conflicts and judgement calls

**Conflicts (the plan and ADRs win):**

1. **The Hardware tab on mobile.** Phase 6 hid it under 768 px. Plan Task 10 shows it at every width with the SVG board, which matches §8.3's "3D off by default". This brief follows Task 10.
2. **The code region.** `MemRegion` includes `"code"` (Task 3), so a fetch needs somewhere to land, but Task 8's RAM `InstancedMesh` is 3 × 64 (stack, young, old). **Proposal:** add a 16-cell code strip, making the fixed count 208. Otherwise fetch pulses would end at a label with no cells. Task 8 should confirm.
3. **Young semi-spaces.** `HeapRegion` has no from/to split. The split comes from `heapStrip` (Task 4) and is Illustrative, which is consistent with the panel's badge.
4. **"Labels drawn once" (D4) versus register values.** Name and role sprites are drawn once. Value textures redraw only when the value changes, through refs, not React. This keeps D4's intent of no troika and no per-frame work.

**Judgement calls (not dictated by any source):**

- The grid adapts to the container's **height**, with sub-tabs in the short tier, because the default split leaves 150 to 190 px.
- The tab never auto-resizes the split; a once-per-session hint suggests dragging instead.
- The hidden-class tree grows **horizontally**, to suit short, wide panels.
- The IC panel badge takes the **weakest** row level.
- "(no way back)" is per-node accessible text plus one visible legend, rather than repeated on every dim node.
- The tier ramp is neutral, not hued, so green stays "current" and red stays "deopt".
- The board readout row doubles as the canvas label and the small-size fallback.
- At 375 px the graph defaults to Table view.
