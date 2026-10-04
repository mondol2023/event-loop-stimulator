# Target

Everything "real" in this project means **this** Node.js/V8 pair (PROMPT.md §3.1). Conformance expectations (`tests/conformance/**/*.expected.json`) are recorded only on it, and `npm run conformance:record` refuses to run anywhere else (`scripts/conformance/target.mts` parses the table below).

| Component | Version |
|---|---|
| Node.js | `24.19.0` |
| V8 | `13.6.233.17-node.51` |

Pinned on 2026-10-05 from `process.versions` of the current Active LTS line (Node 24 "Krypton").

## Program model

- A CommonJS script, run exactly as `node main.cjs`.
- TypeScript is handled the way Node's built-in type stripping does it: types are erased to whitespace so positions are preserved. Syntax that needs a transform (`enum`, `namespace`, parameter properties) is refused with a diagnostic, as strip-only mode refuses it.
- Error output is normalized in one way only: the script path becomes `main.cjs`.

## Upgrading

Bumping the target is deliberate: edit the table, re-record every expectation with `npm run conformance:record` on the new runtime, review the diffs, and add an ADR to `docs/DECISIONS.md`. Never edit a recorded expectation by hand to make a test pass.
