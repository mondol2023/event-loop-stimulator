// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { TRUTH_TOOLTIPS } from "@/core/shared/fidelity";
import type { FunctionId } from "@/core/shared/ids";
import { ConsolePanel } from "@/features/event-loop-2d/ConsolePanel";
import { BytecodePane } from "@/features/playground/components/panes/BytecodePane";
import { PreferencesContext } from "@/features/preferences/PreferencesProvider";
import type { UsageMode } from "@/features/preferences/modes";
import { PlaygroundStoreContext } from "@/features/playground/store/PlaygroundContext";
import { createPlaygroundStore, type PlaygroundStore } from "@/features/playground/store/playgroundStore";
import { fixtureRun, runSource } from "@/features/playground/test/fixtureTimeline";
import { ElementsLattice } from "./components/ElementsLattice";
import { FrameInspector } from "./components/FrameInspector";
import { IcTable } from "./components/IcTable";
import { V8InternalsView } from "./components/V8InternalsView";

afterEach(cleanup);

// jsdom does no layout; CodeMirror's scroll measuring asks ranges for rects.
beforeAll(() => {
  Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) });
});

function storeFrom(responses: ReturnType<typeof runSource>): PlaygroundStore {
  const store = createPlaygroundStore();
  for (const response of responses) store.getState().applyPipelineEvent({ kind: "response", response });
  return store;
}

const readyStore = (name: string): PlaygroundStore => {
  const { compiled, simulated } = fixtureRun(name);
  return storeFrom([compiled, simulated]);
};

function ui(store: PlaygroundStore, children: ReactElement, mode: UsageMode = "self-study"): ReactElement {
  const prefs = { theme: "dark" as const, mode, setTheme: () => undefined, setMode: () => undefined };
  return (
    <PreferencesContext.Provider value={prefs}>
      <PlaygroundStoreContext.Provider value={store}>{children}</PlaygroundStoreContext.Provider>
    </PreferencesContext.Provider>
  );
}

const seek = (store: PlaygroundStore, index: number) => act(() => store.getState().seek(index));
const last = (store: PlaygroundStore): number => store.getState().playback.length - 1;
const panel = (name: string): HTMLElement => screen.getByRole("region", { name });
const panelBadge = (name: string): string => within(within(panel(name)).getByTestId("panel-header")).getByRole("button").getAttribute("aria-label") ?? "";

describe("FrameInspector", () => {
  it("shows the accumulator and registers with a Smi or HeapObject marker per row", () => {
    const store = readyStore("nexttick-vs-promise");
    seek(store, 1);
    render(ui(store, <FrameInspector />));
    const table = within(panel("Frame")).getByRole("table");
    const rows = within(table).getAllByRole("row");
    // The header row, acc, then r0..rn of the script.
    expect(rows.length).toBeGreaterThan(2);
    expect(within(rows[1] as HTMLElement).getByText("acc")).toBeTruthy();
    expect(within(table).getAllByText("HeapObject").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Oddball").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("undefined").length).toBeGreaterThan(0);
  });

  it("shows a Smi with its tagged word", () => {
    const store = storeFrom(runSource("const a = 5;\nconsole.log(a);", 1));
    let found = false;
    for (let i = 0; i <= last(store) && !found; i++) {
      seek(store, i);
      const { unmount } = render(ui(store, <FrameInspector />));
      if (screen.queryAllByText("0x0000000a").length > 0) {
        found = true;
        expect(within(panel("Frame")).getAllByText("Smi").length).toBeGreaterThan(0);
      }
      unmount();
    }
    expect(found).toBe(true);
  });

  it("says so before any run and when no frame is live", () => {
    render(ui(createPlaygroundStore(), <FrameInspector />));
    expect(screen.getByText("Registers appear when your code runs. Press Play or step forward.")).toBeTruthy();
    cleanup();
    const store = readyStore("nexttick-vs-promise");
    seek(store, 7);
    render(ui(store, <FrameInspector />));
    expect(screen.getByText(/No JavaScript frame right now/)).toBeTruthy();
  });

  // Review Focus 5: predict-first must not leak the printed text through the frame.
  it("hides the string being printed in interview mode until the learner reveals", () => {
    const store = readyStore("nexttick-vs-promise");
    seek(store, 1);
    render(
      ui(
        store,
        <>
          <FrameInspector />
          <ConsolePanel />
        </>,
        "interview",
      ),
    );
    const frame = panel("Frame");
    expect(within(frame).queryByText(/sync 1/)).toBeNull();
    expect(frame.textContent).not.toContain("sync 1");
    expect(within(frame).getByText("string, hidden until you reveal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(within(panel("Frame")).getByText('"sync 1"')).toBeTruthy();
  });

  it("badges the panel Verified model with its tooltip sentence", () => {
    const store = readyStore("nexttick-vs-promise");
    seek(store, 1);
    render(ui(store, <FrameInspector />));
    expect(panelBadge("Frame")).toContain(TRUTH_TOOLTIPS["verified-model"]);
  });
});

describe("IcTable", () => {
  it("lists a row per feedback slot with state words and Map chips", () => {
    const store = readyStore("hidden-classes-shapes");
    seek(store, last(store));
    render(ui(store, <IcTable />));
    const table = within(panel("Inline caches")).getByRole("table");
    expect(within(table).getAllByText("monomorphic").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("SetNamedSloppy").length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/^Map#\d+$/).length).toBeGreaterThan(0);
  });

  it("badges the panel with the weakest row level, and each row with its own", () => {
    const verified = readyStore("hidden-classes-shapes");
    seek(verified, last(verified));
    render(ui(verified, <IcTable />));
    expect(panelBadge("Inline caches")).toContain(TRUTH_TOOLTIPS["verified-model"]);
    cleanup();

    // SetKeyedSloppy is not a kind recorded against real %DebugPrint, so that row (and the panel) is Modeled.
    const modeled = readyStore("elements-kinds-lattice");
    seek(modeled, last(modeled));
    render(ui(modeled, <IcTable />));
    expect(panelBadge("Inline caches")).toContain(TRUTH_TOOLTIPS.modeled);
    const rows = within(panel("Inline caches")).getAllByRole("row");
    const keyed = rows.find((r) => within(r).queryByText("SetKeyedSloppy"));
    expect(within(keyed as HTMLElement).getByRole("button").getAttribute("aria-label")).toContain(TRUTH_TOOLTIPS.modeled);
  });

  it("caps at 50 rows with a Show all N button", () => {
    // Distinct names, since a repeated access to one name shares its feedback slot.
    const source = ["const o = { x: 1 };", ...Array.from({ length: 60 }, (_, n) => `o.p${n};`)].join("\n");
    const store = storeFrom(runSource(source, 1));
    seek(store, last(store));
    render(ui(store, <IcTable />));
    const table = within(panel("Inline caches")).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(51);
    const button = screen.getByRole("button", { name: /^Show all \d+$/ });
    const total = Number(/\d+/.exec(button.textContent ?? "")?.[0]);
    expect(total).toBeGreaterThan(50);
    fireEvent.click(button);
    expect(within(table).getAllByRole("row")).toHaveLength(total + 1);
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("selects the focused slot's row", () => {
    const store = readyStore("hidden-classes-shapes");
    seek(store, last(store));
    render(ui(store, <IcTable />));
    expect(document.querySelector('tr[aria-selected="true"]')).toBeNull();
    act(() => store.getState().focusFeedbackSlot({ functionId: 1 as FunctionId, slot: 0 }));
    const selected = document.querySelectorAll('tr[aria-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain("Point");
    expect(selected[0]?.textContent).toContain("[0]");
  });
});

describe("bytecode pane slot links", () => {
  // A jsdom CodeMirror renders only the first lines, so the program is small and its first inline cache is slot 0.
  const SOURCE = "const o = {};\no.x = 1;\nconsole.log(o.x);";

  it("clicking a feedback operand sets focusSlot and marks that IC row aria-selected", () => {
    const store = storeFrom(runSource(SOURCE, 1));
    seek(store, last(store));
    render(
      ui(
        store,
        <>
          <BytecodePane />
          <IcTable />
        </>,
      ),
    );
    const link = document.querySelector<HTMLElement>('.cm-sl-slot-link[data-function-id="0"][data-slot="0"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("[0]");
    expect(document.querySelector('tr[aria-selected="true"]')).toBeNull();
    fireEvent.click(link as HTMLElement);
    expect(store.getState().focusSlot).toEqual({ functionId: 0, slot: 0 });
    const selected = document.querySelectorAll('tr[aria-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain("[0]");
    expect(selected[0]?.textContent).toContain("SetNamedSloppy");
  });

  it("links only the feedback operand of an instruction", () => {
    const store = storeFrom(runSource(SOURCE, 1));
    render(ui(store, <BytecodePane />));
    const links = [...document.querySelectorAll(".cm-sl-slot-link")];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l.textContent).toMatch(/^\[\d+\]$/);
      // A constant-pool or context index is not a slot.
      expect(l.closest(".cm-line")?.textContent).not.toMatch(/LdaConstant|LdaCurrentContextSlot|LdaSmi/);
    }
  });
});

describe("ElementsLattice", () => {
  it("shows a teaching empty state before any array exists", () => {
    const store = readyStore("elements-kinds-lattice");
    seek(store, 0);
    render(ui(store, <ElementsLattice />));
    expect(screen.getByText(/No arrays yet/)).toBeTruthy();
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });

  it("marks the kind of the most recent array that changed, one-way, with unreachable kinds named", () => {
    const store = readyStore("elements-kinds-lattice");
    seek(store, last(store));
    const { container } = render(ui(store, <ElementsLattice />));
    const items = within(panel("Elements kinds")).getAllByRole("listitem");
    expect(items).toHaveLength(7);
    const current = container.querySelectorAll('li[aria-current="true"]');
    expect(current).toHaveLength(1);
    // The last array to change is the map() result (PACKED_ELEMENTS), so PACKED_SMI has no way back.
    expect(current[0]?.querySelector("[data-kind]")?.textContent).toBe("PACKED_ELEMENTS");
    expect(within(current[0] as HTMLElement).getByText("current")).toBeTruthy();
    expect(within(items[0] as HTMLElement).getByText("(no way back)")).toBeTruthy();
    expect(screen.getByText("Dimmed: no way back from the current kind.")).toBeTruthy();
  });

  it("badges the panel Verified model with its tooltip sentence", () => {
    const store = readyStore("elements-kinds-lattice");
    seek(store, last(store));
    render(ui(store, <ElementsLattice />));
    expect(panelBadge("Elements kinds")).toContain(TRUTH_TOOLTIPS["verified-model"]);
  });
});

describe("V8InternalsView", () => {
  it("composes the panels and leaves named slots for the later ones", () => {
    const store = readyStore("hidden-classes-shapes");
    seek(store, last(store));
    const { container } = render(ui(store, <V8InternalsView />));
    expect(panel("Frame")).toBeTruthy();
    expect(panel("Inline caches")).toBeTruthy();
    expect(panel("Elements kinds")).toBeTruthy();
    for (const slot of ["hidden-classes", "heap", "tiers"]) expect(container.querySelector(`[data-slot="${slot}"]`)).not.toBeNull();
  });
});
