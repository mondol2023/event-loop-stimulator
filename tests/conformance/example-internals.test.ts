import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseExpectation } from "../../scripts/conformance/expectation.mts";
import { consoleCallTick, recordRun, stripProbes } from "./helpers/consoleCallArgs";

// The internals examples (Phase 7) explain Maps and elements kinds with the simulator's own model. Each has a natives
// twin: the example's source plus probe lines, recorded on real node. These tests prove that what the timeline shows
// at each probe equals what real V8 printed, so the examples teach what is true.

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

/** `n` is the probe's number; `exampleLine` is the 1-based line of the example's console.log the probe follows. */
type Probe = { readonly n: number; readonly exampleLine: number };

/** Each probe line of a twin and the example line it follows (the line above it, in the twin without probes). */
function probesOf(twin: string): Probe[] {
  const probes: Probe[] = [];
  let exampleLines = 0;
  for (const line of twin.replace(/\n\/\/ Probe helper[\s\S]*$/, "").split("\n")) {
    const m = /^console\.log\("probe (\d+)"/.exec(line);
    if (m) probes.push({ n: Number(m[1]), exampleLine: exampleLines });
    else exampleLines++;
  }
  return probes;
}

/** What real node printed for each probe: `probe <n> <rest>`. */
function recordedProbes(name: string): Map<number, string> {
  const expectation = parseExpectation(JSON.parse(read(`internals/${name}-natives.expected.json`)));
  const stdout = expectation.outcomes[0]?.stdout ?? "";
  return new Map([...stdout.matchAll(/^probe (\d+) (.*)$/gm)].map((m) => [Number(m[1]), m[2] as string]));
}

const PAIRS = [
  { name: "hidden-classes-shapes", probes: 3 },
  { name: "elements-kinds-lattice", probes: 4 },
] as const;

describe("natives twins are their examples plus probes", () => {
  for (const { name, probes } of PAIRS) {
    it(`${name}: stripping the probes gives the example back`, () => {
      const twin = read(`internals/${name}-natives.cjs`);
      expect(stripProbes(twin)).toBe(read(`fixtures/${name}.cjs`));
      expect(probesOf(twin)).toHaveLength(probes);
      expect(recordedProbes(name).size).toBe(probes);
    });
  }
});

describe("hidden-classes-shapes: the timeline's Maps agree with %HaveSameMap on real node", () => {
  const twin = read("internals/hidden-classes-shapes-natives.cjs");
  const run = recordRun(read("fixtures/hidden-classes-shapes.cjs"));
  const recorded = recordedProbes("hidden-classes-shapes");

  for (const probe of probesOf(twin)) {
    it(`probe ${probe.n}`, () => {
      const [first, second] = consoleCallTick(run, probe.exampleLine).args;
      if (first?.kind !== "object" || second?.kind !== "object") throw new Error("expected two object arguments");
      expect(recorded.get(probe.n)).toMatch(/^(true|false)$/);
      expect(first.mapId === second.mapId).toBe(recorded.get(probe.n) === "true");
    });
  }

  it.todo("the view agrees: transitionLayout(tick.v8.maps) contains both mapIds (Task 4)");
});

describe("elements-kinds-lattice: the timeline's elements kinds agree with the recorded kind() on real node", () => {
  const twin = read("internals/elements-kinds-lattice-natives.cjs");
  const run = recordRun(read("fixtures/elements-kinds-lattice.cjs"));
  const recorded = recordedProbes("elements-kinds-lattice");

  for (const probe of probesOf(twin)) {
    it(`probe ${probe.n}`, () => {
      const { tick, args } = consoleCallTick(run, probe.exampleLine);
      const list = args[0];
      if (list?.kind !== "object") throw new Error("expected the array as the first argument");
      expect(tick.v8.elementsKinds[list.id]).toBe(recorded.get(probe.n));
    });
  }

  it.todo("the view agrees: latticeModel(kind) highlights the recorded kind (Task 4)");
});
