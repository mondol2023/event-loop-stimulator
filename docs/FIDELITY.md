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
| Uncaught exception / unhandled rejection output, and the exit code | **Exact** after documented normalization (file path → `main.cjs`) | V8 message templates; differential tests |
| Variable values, object key order, number→string conversion | **Exact** | Spec operations; differential tests |
| AST and scope analysis (hoisting, TDZ, closures) | **Exact** with respect to ESTree and spec scoping | Parser + scope unit tests |
| Ignition bytecode listing | **Verified model** | Same opcode sequence as `node --print-bytecode` for every fixture function; operand differences listed below |
| Hidden classes (Maps), transitions, in-object vs backing-store properties, elements kinds | **Verified model** | Fixtures assert against V8 natives (`--allow-natives-syntax`: `%HaveSameMap`, `%HasSmiElements`, `%HasDoubleElements`, `%DebugPrint`) |
| Inline-cache states, feedback slots | **Verified model** where `%DebugPrint` exposes it; otherwise **Modeled** | Fixture checks |
| Tier-up to Sparkplug / Maglev / TurboFan and deopts | **Modeled** | Shown as "would typically…"; sanity-checked with `%GetOptimizationStatus` fixtures |
| Smi vs HeapObject tagging, pointer compression | **Verified model** | Matches V8's documented tagging scheme for the pinned build config |
| Heap addresses, young/old generation occupancy, GC timing | **Illustrative** | Never affects Exact results |
| Machine code (assembly) and register contents | **Illustrative** | Sparkplug-style per-bytecode templates using V8's real x64 register roles |
| Machine-code bytes | **Exact encoding of the shown assembly** | Golden bytes checked against `llvm-mc --show-encoding` |
| CPU caches, ALU, buses (3D) | **Illustrative** | — |

## Excluded constructs

These are refused with a diagnostic instead of approximated. The list is filled in during Phase 2, alongside `SUPPORTED_SUBSET.md`.

## Known gaps

Each gap names the construct, the difference from real Node/V8, and the fixture that shows it. There are none yet: the interpreter lands in Phase 3.

## Bytecode operand differences

Opcode sequences match `--print-bytecode`. Operand-level differences are listed here, per fixture. There are none yet: the bytecode generator lands in Phase 2.
