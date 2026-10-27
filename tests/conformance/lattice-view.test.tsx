// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "@/core/shared/zod";
import { PlaygroundStoreContext } from "@/features/playground/store/PlaygroundContext";
import { createPlaygroundStore } from "@/features/playground/store/playgroundStore";
import { fixtureRun } from "@/features/playground/test/fixtureTimeline";
import { ElementsLattice } from "@/features/v8-internals/components/ElementsLattice";
import { consoleCallTick, recordRun } from "./helpers/consoleCallArgs";

// The lattice component must highlight the kind real node printed, at every probe of the example. This lives
// here, not under features/, because only the conformance harness may import the recorded-run helpers.

afterEach(cleanup);

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

// Read the recorded stdout directly: the harness's parser is a .mts module, which a .tsx test may not import.
function recordedKinds(): string[] {
  const recorded = z.object({ outcomes: z.array(z.object({ stdout: z.string() })).min(1) }).parse(JSON.parse(read("internals/elements-kinds-lattice-natives.expected.json")));
  const stdout = recorded.outcomes[0]?.stdout ?? "";
  return [...stdout.matchAll(/^probe (\d+) (.*)$/gm)].map((m) => m[2] as string);
}

describe("ElementsLattice on elements-kinds-lattice", () => {
  const run = recordRun(read("fixtures/elements-kinds-lattice.cjs"));
  const { compiled, simulated } = fixtureRun("elements-kinds-lattice");
  // The example's `console.log(list ...)` lines, in probe order.
  const lines = [3, 6, 9, 14];
  const recorded = recordedKinds();

  it("has one recorded kind per probe line", () => expect(recorded).toHaveLength(lines.length));

  lines.forEach((line, n) => {
    it(`probe ${n + 1}: aria-current equals the recorded kind`, () => {
      const store = createPlaygroundStore();
      store.getState().applyPipelineEvent({ kind: "response", response: compiled });
      store.getState().applyPipelineEvent({ kind: "response", response: simulated });
      const { tick } = consoleCallTick(run, line);
      act(() => store.getState().seek(tick.index));
      const { container } = render(
        <PlaygroundStoreContext.Provider value={store}>
          <ElementsLattice />
        </PlaygroundStoreContext.Provider>,
      );
      expect(container.querySelector('li[aria-current="true"] [data-kind]')?.textContent).toBe(recorded[n]);
    });
  });
});
