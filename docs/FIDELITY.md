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

## How real bytecode is captured

`npm run conformance:record` captures the bytecode of every `kind: "program"` fixture that exits 0 or declares `expect: "run"`, in a second run of the fixture (`scripts/conformance/bytecode-capture.mts`). **The primary path shipped**; neither fallback (dropping `--permission`, name filters) was needed.

- **Run.** The fixture runs through the same sandbox as its recorded run (`--permission` with no grants beyond read access to `scripts/conformance/mark.cjs`, empty env, timeout, 64 MiB heap), plus `--print-bytecode --no-compact --no-flush-bytecode --require mark.cjs`. The output cap is raised to 32 MiB, because the listing includes ~100 Node-internal functions (about 1 MB even for a small program).
- **Root.** `mark.cjs` calls `__silicon_marker__()` just before Node compiles `main.cjs`/`main.cts`. The main script is the first `Parameter count 6` block after the marker block. The capture also checks that the 5-byte CJS wrapper block comes just before it.
- **Children.** Children are found by walking SharedFunctionInfo addresses from the root's constant pool to the matching block headers, never by name. `--no-compact` keeps SFIs from moving and `--no-flush-bytecode` keeps each function compiled once. An address that is compiled twice, or a block whose name differs from the pool entry, aborts the record. A function that was never called has no block and is left out of `children`.
- **`.cts` positions.** Node appends `\n\n//# sourceURL=file:///<temp dir>/main.cts` to a stripped `.cts`, so the main script's implicit `Return` position depends on the temp path. Positions that point into that appended text are moved back to the end of the program. The result is exactly what V8 prints for the same stripped text as `.cjs`, so a `.cts` and its whitespace-stripped `.cjs` give identical trees.
- **Failure.** Any surprise in the listing throws `BytecodeCaptureError` and aborts the record, naming the fixture. A capture is never partial.

## Bytecode operand differences

Opcode sequences match `--print-bytecode`. Operand-level differences are listed here, per fixture. There are none yet: the bytecode generator lands in Phase 2.
