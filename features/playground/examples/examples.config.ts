// The playground's example list (PROMPT.md §8.3). Each example is a recorded conformance fixture:
// `npm run examples:sync` reads the fixture source and its `*.expected.json` and writes
// catalog.generated.ts, so the editor text and its "Matches Node vX" badge always come from a real
// recording. This file is plain data and types (no imports) because the sync script loads it under
// Node's type stripping.

export type ExampleConfig = {
  readonly id: string;
  /** Shown in the examples menu; verbatim from PROMPT.md §8.3. */
  readonly title: string;
  /** Stem of a program fixture in tests/conformance/fixtures/ (.cjs or .cts). */
  readonly fixture: string;
  readonly blurb: string;
};

export type Example = ExampleConfig & {
  readonly source: string;
  readonly lang: "js" | "ts";
  /** The pinned runtime the fixture was recorded on; null when there is no recording for docs/TARGET.md. */
  readonly verified: { readonly node: string; readonly v8: string } | null;
  readonly nondeterministic: boolean;
};

export const EXAMPLE_CONFIGS: readonly ExampleConfig[] = [
  {
    id: "promise-vs-settimeout",
    title: "Promise vs setTimeout",
    fixture: "promise-vs-timeout",
    blurb: "Promise jobs all run before the first timer, even a timer set to 0 ms.",
  },
  {
    id: "nexttick-vs-promise",
    title: "nextTick vs Promise",
    fixture: "nexttick-vs-promise",
    blurb: "process.nextTick callbacks drain before promise jobs; the two queues then take turns.",
  },
  {
    id: "async-await-ordering",
    title: "async/await ordering",
    fixture: "async-await-order",
    blurb: "An async function runs synchronously up to its first await, then resumes as a microtask.",
  },
  {
    id: "await-a-thenable",
    title: "await a thenable (the 2 extra ticks)",
    fixture: "await-thenable-two-extra-ticks",
    blurb: "Awaiting a thenable instead of a native promise costs two extra microtask ticks.",
  },
  {
    id: "settimeout-vs-setimmediate",
    title: "setTimeout 0 vs setImmediate (nondeterministic!)",
    fixture: "timeout-vs-immediate-main",
    blurb: "From the main script the order depends on how long startup took, so real Node can print either.",
  },
  {
    id: "hidden-classes",
    title: "hidden classes: same shape vs different order",
    fixture: "hidden-classes-shapes",
    blurb: "Properties added in the same order share one hidden class; a different order forks a new one.",
  },
  {
    id: "elements-kinds",
    title: "elements kinds: SMI → DOUBLE → HOLEY",
    fixture: "elements-kinds-lattice",
    blurb: "An array moves from small integers to doubles to holey, and never back.",
  },
  {
    id: "closure-context",
    title: "closure context",
    fixture: "closure-counter",
    blurb: "A closure keeps its defining scope alive; each call to the factory makes a fresh context.",
  },
  {
    id: "recursive-factorial",
    title: "recursive factorial",
    fixture: "recursion-factorial",
    blurb: "Watch the call stack grow and unwind, and where factorial leaves exact integers behind.",
  },
  {
    id: "uncaught-typeerror",
    title: "uncaught TypeError",
    fixture: "uncaught-type-error",
    blurb: "Reading a property of undefined throws; Node prints the source line, the stack and exits with code 1.",
  },
];
