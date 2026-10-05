// How much each thing on screen can be trusted. The four sentences are the
// ones in docs/FIDELITY.md; keep them identical.

export type TruthLevel = "exact" | "verified-model" | "modeled" | "illustrative";

export const TRUTH_TOOLTIPS: Readonly<Record<TruthLevel, string>> = {
  exact: "Exact: byte-identical to real Node on the pinned version.",
  "verified-model":
    "Verified model: our reconstruction, checked against real V8 on test programs. Your program's details may differ.",
  modeled: "Modeled: how V8 would typically behave; V8's heuristics change between versions.",
  illustrative: "Illustrative: a teaching picture of the idea, not V8's actual output.",
};
