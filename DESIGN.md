# Silicon Loop: design system

The system as shipped after Phase 6, derived from `app/globals.css`, `features/playground/**`, `features/event-loop-2d/**`, `features/preferences/**` and `components/ui/**`. The shape brief is `docs/design/playground-shape.md`; deviations are in `docs/DECISIONS.md` (ADR-048 onward). Tokens live only in `app/globals.css`, and `tests/tooling/contrast.test.ts` guards the 4.5:1 text floor in both themes.

## Principles

- An IDE in Operate mode: scanability, stable positions and keyboard speed outrank expression.
- Saturated color means state only. Color is always paired with a label or an icon.
- Nothing shifts while playing. Glow (green) marks the current tick only.
- Semantic tokens only (`bg-panel`, `text-microtask`), never raw hex in components.

## Color tokens

Dark is the default (`<html class="dark">`); light is the `:root` base and is the classroom/projector theme.

| Token | Dark | Light | Role |
|---|---|---|---|
| `background` | `#0b1120` | `#f8fafc` | Page |
| `panel` | `#0f172a` | `#f1f5f9` | Region bodies |
| `card` / `popover` | `#151e33` | `#ffffff` | Chips, frames, popovers |
| `foreground` | `#f1f5f9` | `#0f172a` | Text |
| `muted-foreground` | `#94a3b8` | `#475569` | Secondary text, gutters, badges |
| `secondary` / `muted` / `accent` | `#1e293b` | `#e2e8f0` | Quiet fills |
| `border` | `#263247` | `#cbd5e1` | Dividers |
| `input` | `#475569` | `#94a3b8` | Control borders |
| `primary` / `current` / `ring` | `#22c55e` / `#22c55e` / `#4ade80` | `#15803d` | Run, current tick, focus ring |
| `microtask` | `#a78bfa` | `#6d28d9` | Microtask queue (V8) and nextTick (violet outline plus a "nextTick" label) |
| `macrotask` | `#fbbf24` | `#b45309` | Timers and immediates, with phase labels |
| `webapi` | `#22d3ee` | `#0e7490` | Host APIs (libuv) |
| `destructive` | `#f87171` | `#b91c1c` | Error |
| `warning` | `#fde047` | `#854d0e` | Fidelity warning (lemon, so it never reads as macrotask) |

`chart-1..5` and `sidebar-*` alias the roles above. The event loop is Node/libuv's and the microtask queue is V8's; the UI says so in its ownership labels.

## Type

- UI: IBM Plex Sans (`--font-sans`, explicit weights). Machine text only (source, AST node text, bytecode, asm, hex, binary, registers, addresses, task labels, tick counters, console output): JetBrains Mono (`--font-mono`) with tabular numerals (set on `code`, `kbd`, `pre`, `samp`, `.font-mono`).
- Scale, fixed rem, ratio 1.125: xs 0.790, sm 0.889, base 1, lg 1.125, xl 1.266, 2xl 1.424, 3xl 1.602, 4xl 1.802.
- Dense modes use `text-sm` for UI and `text-xs` for labels and badges. Classroom sets the root to 112.5% (`html.mode-classroom`), so the whole rem scale grows.
- Radius: `--radius: 0.5rem` with sm 0.6x, md 0.8x, lg 1x, xl 1.4x.

## Truth badges

Quiet: `text-xs`, `text-muted-foreground`, Lucide icon, focusable, tooltip text from `TRUTH_TOOLTIPS` (`core/shared/fidelity.ts`). The active tab's badge sits at the right of its region header.

| Level | Icon | Where |
|---|---|---|
| Exact | `Check` | AST & scopes, Event Loop (2D), Console |
| Verified model | `FlaskConical` | Bytecode |
| Modeled | `Gauge`, dashed outline | Tier data (Phase 7) |
| Illustrative | `PencilLine` | Machine Code assembly, Hardware placeholder |

The editor shows `VerifiedBadge` instead: "Matches Node v24.19.0 (V8 13.6.233.17-node.51)" only when the source equals a recorded example byte for byte, otherwise "Simulated by spec model". Nondeterministic examples add a `TriangleAlert` chip "Order not guaranteed in real Node".

## Iconography

Lucide only, no emoji; icon-only buttons carry an `aria-label` and a tooltip. Panels: Call Stack `Layers`, Microtask `CircleDot`, nextTick `Circle`, Timers `Timer`, Check phase `SkipForward`, Host APIs `Cable`, phase ring `RefreshCw`, warning `TriangleAlert`, error `CircleX`, limit stop `OctagonPause`. `Check` is reserved for Exact/verified.

## Motion

- Durations: `--duration-enter: 220ms`, `--duration-exit: 150ms`; easing `--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1)`. Exits are faster than entrances.
- Stack frames and task moves: spring `{ stiffness: 500, damping: 32 }` (no overshoot); leave with a 0.15 s fade-up inside `AnimatePresence mode="popLayout"`. Task chips fade in over 0.22 s and out over 0.15 s, and share `layoutId` `task-<TaskRef.id>`.
- Motion animates only `transform` and `opacity`, via `motion/react`, and loads lazily.
- Reduced motion: `MotionConfig reducedMotion="user"` for Motion, and a global `prefers-reduced-motion` rule that disables CSS transitions and animations.
- Rejected: GSAP, overshoot easing, orchestrated page-load sequences.

## Regions and breakpoints

Regions mirror the pipeline: editor (what you wrote), code panes AST / Bytecode / Machine Code (what V8 made), bottom panel (what Node did, tick by tick). The playback bar, scrubber and narration line are the spine.

| Width | Layout |
|---|---|
| 1280 px and up | Editor about 40% (min 360 px) and panes about 60% side by side over the top; bottom region full width below. On the Event Loop tab the 2D view is about 70% and the console about 30% as a right column. |
| 1024 to 1279 px | Same regions, editor about 45%; the console becomes a strip under the 2D view. |
| 768 to 1023 px | Stacked; a segmented control Editor / Code / Run shows one region. Playback bar and narration are pinned to the bottom. |
| 375 to 767 px | Single column; V8 group above Node/libuv group, phase ring becomes a five-step row, compact playback bar (two rows; the "More playback" popover is deferred, ADR-053). Hardware tab hidden. Mode control collapses to a menu button that still names the mode. |

Resizing (1024 px and up) uses the in-house `ResizableSplit` (ADR-055) with keyboard-operable separators and double-click reset. No horizontal page scroll at any width.

## Usage modes

Cookies `sl_mode` and `sl_theme` (Lax, one year), read by `app/layout.tsx` so first paint is right; invalid values fall back to the default.

| Mode | Theme | Type | Default speed | Output |
|---|---|---|---|---|
| Self-study | user's | 1x | 1x | live |
| Interview prep | user's | 1x | 2x | predict first: console and narration withheld until Reveal or the last tick |
| Classroom | light unless the learner chose a theme | 1.125x root | 0.5x | live |

## States

Every interactive component has default, hover, focus-visible, active, disabled, loading and error states. Loading uses fixed-height skeletons (no layout shift), never centered spinners. Touch targets are at least 44x44 px with 8 px gaps on coarse pointers; fine-pointer dense toolbars keep at least a 24x24 px hit area. Status (Idle, Compiling, Simulating, Ready, Refused, Failed) is text in `role="status"` with an icon. Narration lives in an `aria-live="polite"` region. Limit stops use `OctagonPause` and never read as a JavaScript error. Code panes highlight the current tick as a solid green-tinted line (`cm-sl-current`) and hover as an outline (`cm-sl-hovered`), both marked `data-sl-highlight`.
