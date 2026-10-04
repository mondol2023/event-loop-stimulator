# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **CS students** building a mental model of how JavaScript actually runs: how V8 compiles it, and how Node's event loop schedules it.
- **Bootcamp learners** who can write async JS but cannot yet explain why it prints in the order it does.
- **Interviewees** rehearsing "what does this print?" questions about promises, `process.nextTick`, timers, `setImmediate` and `async`/`await`.
- **Instructors** (a confirmed secondary audience) who drive the tool live in front of a class.
- **Admins** who monitor the platform, users, abuse and rate limits.

The learner's job: write or pick a small JS/TS program, then see *and understand* what V8 and Node do with it, step by step.

## Product Purpose

Silicon Loop shows how V8 really runs JavaScript.

- **The pipeline.** A program is shown in four synchronized panes: Source → AST & scopes → Ignition bytecode → baseline x86-64 machine code.
- **The run.** It then runs tick by tick across three views: the event loop (2D), V8's internals (hidden classes, inline caches, elements kinds, the heap), and the hardware (3D).
- **Time travel and narration.** Learners can time-travel through the run, and a narration explains *why* each step happened, naming the spec operation or V8 mechanism responsible.

Success looks like this:
- A learner opens "nextTick vs Promise", presses Play, sees **exactly** what real Node prints, and can explain why Node drains `process.nextTick` before V8's microtask queue.
- They can then save and share that moment.

## Positioning

Loupe and JS Visualizer 9000 show the queues, but they are often wrong on subtle orderings and say nothing about the engine. Silicon Loop is different in three ways:

1. **Correct to the byte.** Console output, ordering, values, errors and exit codes match the pinned Node/V8 release, proven by differential tests against real Node.
2. **Honest about its internals.** Every view carries a truth badge: Exact, Verified model, Modeled or Illustrative.
3. **Consistent.** Every view derives from one bytecode representation, as in V8, so they always agree.

## Operating Context

The product supports three usage modes, and **the learner chooses one in the UI** (a visible, switchable control; persistent per user/device). None is the fixed default priority:

- **Self-study:** alone at a laptop, poking at snippets. Density and depth are welcome.
- **Interview prep:** rehearsing output-ordering questions, so fast example loading, predicting before revealing, and crisp ordering explanations come first.
- **Classroom:** an instructor projects it. Legibility at distance, the light theme, and deliberate step pacing come first.

Snippets are shared through permalinks that can point at an exact tick (`/s/<slug>?t=42`).

## Capabilities and Constraints

- Supported input is a documented JS/TS **subset** (see `docs/SUPPORTED_SUBSET.md`). Anything outside it gets an inline diagnostic with a hint, never a silent failure.
- **User code is never executed** by any real engine. It is parsed and interpreted by our own spec model only.
- **Exact or refused.** Observable results are exact for the pinned Node/V8 (`docs/TARGET.md`). Anything we can't guarantee is refused with a diagnostic, never approximated.
- **Nondeterminism is flagged.** Truly nondeterministic orderings (e.g. `setTimeout 0` vs `setImmediate`) carry an "Order not guaranteed in real Node" warning.
- **Machine code is illustrative.** The assembly is a Sparkplug-style illustration, not V8's actual output, and is labelled that way (`docs/FIDELITY.md`).
- **Teach the boundary.** V8 owns the language, heap and microtasks. Node/libuv owns the event loop.
- Accounts: anonymous visitors can compile and simulate. Signed-in users can save, share and fork snippets. Admins moderate.
- Limits: source ≤ 10 KB, ≤ 400 lines, ≤ 5,000 ticks, call depth ≤ 64, ≤ 1,024 heap objects, ≤ 60 s virtual time. Hitting one shows "Simulation limit reached — real Node would continue", never a fake JS error.
- **Open decision:** what each usage mode concretely changes (defaults for speed, theme, density, predict-first prompts) is decided when the playground surface is shaped (Phase 6).

## Brand Commitments

- Name: **Silicon Loop** (final).
- Voice: **friendly coach**. Warm, encouraging and conversational, but always technically exact. Narration explains the *why*. Error messages say what happened and what to try instead. Never talk down to the learner, and never trade correctness for friendliness.

## Evidence on Hand

None yet. There are no testimonials, user counts, benchmarks or institutional adopters, and future work must not fabricate any. "Matches Node vX" badges appear only on examples whose output was really recorded on that Node.

## Product Principles

1. **Teach the truth.** Observable results equal real V8. Every internal view states how true it is, and a model is never presented as V8's real output.
2. **Every view agrees.** One bytecode representation drives every pane, queue and hardware signal.
3. **Explain why, not just what.** Each step names the mechanism responsible, as a reason the learner can carry to the next program.
4. **The learner sets the pace and the mode.** They choose how they use it, and the tool adapts to that choice.
5. **Safe by construction.** User code is never executed, anywhere.

## Accessibility & Inclusion

WCAG 2.2 AA, full keyboard control, `prefers-reduced-motion` support, a non-WebGL fallback for the 3D view, narration in an `aria-live` region, and color never as the only signal. Classroom mode must stay legible on a projector.
