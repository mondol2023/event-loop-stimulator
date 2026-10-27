// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TierTrack } from "@/core/interpreter/tiering/tierTimeline";
import { TRUTH_TOOLTIPS } from "@/core/shared/fidelity";
import { asFunctionId, type FunctionId } from "@/core/shared/ids";
import { ConsolePanel } from "@/features/event-loop-2d/ConsolePanel";
import { BytecodePane } from "@/features/playground/components/panes/BytecodePane";
import { PreferencesContext } from "@/features/preferences/PreferencesProvider";
import type { UsageMode } from "@/features/preferences/modes";
import { PlaygroundStoreContext } from "@/features/playground/store/PlaygroundContext";
import { createPlaygroundStore, type PlaygroundStore } from "@/features/playground/store/playgroundStore";
import { getTimeline } from "@/features/playground/store/timelineHolder";
import { fixtureRun, runSource } from "@/features/playground/test/fixtureTimeline";
import type { GcEvent } from "@/core/timeline/Tick";
import { ElementsLattice } from "./components/ElementsLattice";
import { FrameInspector } from "./components/FrameInspector";
import { HeapStrip, HeapStripView } from "./components/HeapStrip";
import { HiddenClassGraph } from "./components/HiddenClassGraph";
import { IcTable } from "./components/IcTable";
import { TierTimeline } from "./components/TierTimeline";
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
    // The tick where the script's first console.log has loaded "sync 1" into a register: the first the frame could leak it.
    // (consoleCallTick lives in tests/conformance, which features/ may not import, so it is found in the held timeline.)
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("the store holds no timeline");
    const holdsSync1 = (i: number): boolean => timeline.at(i).callStack.at(-1)?.registers.some((r) => r.kind === "string" && r.value === "sync 1") ?? false;
    const leakTick = Array.from({ length: timeline.length }, (_, i) => i).find(holdsSync1);
    if (leakTick === undefined) throw new Error("no tick holds the string");
    expect(leakTick).toBeGreaterThan(0);
    expect(holdsSync1(leakTick - 1)).toBe(false);
    seek(store, leakTick);
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

const timelineOf = (store: PlaygroundStore) => {
  const timeline = getTimeline(store);
  if (!timeline) throw new Error("the store holds no timeline");
  return timeline;
};
const mapIdsOf = (root: HTMLElement): number[] =>
  [...root.querySelectorAll("svg text")].flatMap((t) => /^Map#(\d+)$/.exec(t.textContent ?? "")?.[1] ?? []).map(Number);

describe("HiddenClassGraph", () => {
  it("draws a node for every Map the held tick lists, and the Table view lists the same ids", () => {
    const store = readyStore("hidden-classes-shapes");
    seek(store, last(store));
    const maps = timelineOf(store).at(last(store)).v8.maps;
    render(ui(store, <HiddenClassGraph />));
    const region = panel("Hidden classes");
    const drawn = mapIdsOf(region);
    expect(drawn.length).toBeGreaterThan(0);
    for (const m of maps) expect(drawn).toContain(m.id);
    // a and b share Point's Map with x and y until b.z = 9 moves b to its child with z.
    const withKeys = (keys: string): number | undefined => maps.find((m) => m.fields.map((f) => f.key).join() === keys)?.id;
    expect(drawn).toContain(withKeys("x,y"));
    expect(drawn).toContain(withKeys("x,y,z"));
    expect(new Set(drawn).size).toBe(drawn.length);

    const toggle = within(region).getByRole("button", { name: "Table" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(within(region).getByRole("button", { name: "Table" }).getAttribute("aria-pressed")).toBe("true");
    const table = within(region).getByRole("table");
    const ids = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => Number(/^Map#(\d+)$/.exec(within(r).getAllByRole("cell")[0]?.textContent ?? "")?.[1]));
    expect([...ids].sort((a, b) => a - b)).toEqual([...drawn].sort((a, b) => a - b));
    expect(region.querySelector('svg[role="img"]')).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Graph" }));
    expect(within(region).queryByRole("table")).toBeNull();
  });

  it("labels each edge with the key it added", () => {
    const store = readyStore("hidden-classes-shapes");
    seek(store, last(store));
    render(ui(store, <HiddenClassGraph />));
    const labels = [...panel("Hidden classes").querySelectorAll("svg [data-edge-label]")].map((t) => t.textContent);
    expect(labels).toContain("z");
    expect(labels).toContain("x");
  });

  it("marks the Map that changed on this tick current, once, with the word", () => {
    const store = readyStore("hidden-classes-shapes");
    const timeline = timelineOf(store);
    const tick = Array.from({ length: timeline.length }, (_, i) => i).find((i) => timeline.at(i).v8.changedMapId !== undefined);
    if (tick === undefined) throw new Error("no tick changes a Map");
    seek(store, tick);
    const { container } = render(ui(store, <HiddenClassGraph />));
    const current = container.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain(`Map#${timeline.at(tick).v8.changedMapId}`);
    expect(current[0]?.textContent).toContain("current");
  });

  it("names dictionary and deprecated Maps in words, in both views", () => {
    const store = storeFrom(runSource("const o = {a:1,b:2,c:3};\ndelete o.a;\nconst p = {x: 1};\np.x = 1.5;\nconsole.log(o, p);", 1));
    seek(store, last(store));
    render(ui(store, <HiddenClassGraph />));
    const region = panel("Hidden classes");
    expect(within(region).getAllByText("dictionary").length).toBeGreaterThan(0);
    expect(within(region).getAllByText("deprecated").length).toBeGreaterThan(0);
    fireEvent.click(within(region).getByRole("button", { name: "Table" }));
    expect(within(within(region).getByRole("table")).getAllByText(/dictionary/).length).toBeGreaterThan(0);
    expect(within(within(region).getByRole("table")).getAllByText(/deprecated/).length).toBeGreaterThan(0);
  });

  it("says how many Maps the 128 cap left off", () => {
    const source = Array.from({ length: 140 }, (_, n) => `${n === 0 ? "const o = {};\n" : ""}o.p${n} = 1;`).join("\n");
    const store = storeFrom(runSource(source, 1));
    seek(store, last(store));
    render(ui(store, <HiddenClassGraph />));
    expect(within(panel("Hidden classes")).getByText(/^\+\d+ more Maps$/)).toBeTruthy();
  });

  it("teaches before any object exists, and badges the panel Verified model", () => {
    render(ui(createPlaygroundStore(), <HiddenClassGraph />));
    expect(screen.getByText("No objects yet: hidden classes appear when your code creates one.")).toBeTruthy();
    expect(panelBadge("Hidden classes")).toContain(TRUTH_TOOLTIPS["verified-model"]);
  });
});

describe("HeapStrip", () => {
  // The default young generation is 16 KB, so a few hundred short-lived objects force a scavenge.
  const GC_SOURCE = "const keep = [];\nfor (let i = 0; i < 400; i++) { keep.push({ i }); const scratch = { t: i, u: [i] }; }\nconsole.log(keep.length);";
  const gcStore = (): { store: PlaygroundStore; gcTick: number } => {
    const store = storeFrom(runSource(GC_SOURCE, 1));
    const timeline = timelineOf(store);
    const gcTick = Array.from({ length: timeline.length }, (_, i) => i).find((i) => timeline.at(i).phase === "gc");
    if (gcTick === undefined) throw new Error("the program did not collect");
    return { store, gcTick };
  };

  it("labels the scavenge, with its counts, on and after the tick that collected", () => {
    const { store, gcTick } = gcStore();
    seek(store, gcTick);
    render(ui(store, <HeapStrip />));
    const region = panel("Heap");
    expect(within(region).getByText("scavenge")).toBeTruthy();
    expect(within(region).getByText(/freed 450/)).toBeTruthy();
    for (const lane of ["Young · from", "Young · to", "Old"]) expect(within(region).getByText(lane)).toBeTruthy();
    cleanup();
    seek(store, gcTick + 5);
    render(ui(store, <HeapStrip />));
    expect(within(panel("Heap")).getByText("scavenge")).toBeTruthy();
  });

  it("says no collection has happened yet, before the first one", () => {
    const { store, gcTick } = gcStore();
    seek(store, gcTick - 1);
    render(ui(store, <HeapStrip />));
    const region = panel("Heap");
    expect(within(region).queryByText("scavenge")).toBeNull();
    expect(within(region).getByText(/No garbage collection so far/)).toBeTruthy();
  });

  it("badges the panel Illustrative and always shows the estimates caption", () => {
    const { store, gcTick } = gcStore();
    seek(store, gcTick);
    render(ui(store, <HeapStrip />));
    expect(panelBadge("Heap")).toContain(TRUTH_TOOLTIPS.illustrative);
    expect(within(panel("Heap")).getByText(/Sizes are estimates; GC never changes your program's output\./)).toBeTruthy();
  });

  it("says nothing is allocated before a run", () => {
    render(ui(createPlaygroundStore(), <HeapStrip />));
    expect(screen.getByText("Nothing allocated yet.")).toBeTruthy();
  });

  it("labels promoted cells when a scavenge moved objects to Old", () => {
    const lastGc: GcEvent = { type: "scavenge", freedObjects: 10, freedBytes: 0, survivedObjects: 5, promotedObjects: 3, fromSpace: "0x1", toSpace: "0x2", durationMs: 1, illustrative: true };
    const region = { objectCount: 4, usedBytes: 512, capacityBytes: 1024 };
    render(<HeapStripView heap={{ young: region, old: region, lastGc }} fresh />);
    expect(screen.getByText("promoted")).toBeTruthy();
    expect(screen.getByText(/promoted 3/)).toBeTruthy();
  });
});

describe("TierTimeline", () => {
  const track = (n: number, extra: Partial<TierTrack> = {}): TierTrack => ({
    functionId: asFunctionId(n),
    functionName: `fn${n}`,
    segments: [
      { from: 0, tier: "ignition" },
      { from: 4, tier: "sparkplug" },
    ],
    deopts: [],
    ...extra,
  });
  const withTracks = (tracks: TierTrack[]): PlaygroundStore => {
    const store = readyStore("hidden-classes-shapes");
    store.setState((s) => ({ compile: { ...s.compile, tierTracks: tracks } }));
    return store;
  };

  it("caps at 50 rows with Show all N", () => {
    const store = withTracks(Array.from({ length: 80 }, (_, n) => track(n + 1)));
    render(ui(store, <TierTimeline />));
    const region = panel("V8 would typically tier up here");
    expect(within(region).getAllByRole("listitem")).toHaveLength(50);
    fireEvent.click(within(region).getByRole("button", { name: "Show all 80" }));
    expect(within(region).getAllByRole("listitem")).toHaveLength(80);
    expect(within(region).queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("explains the function never got hot when there are no tracks", () => {
    render(ui(withTracks([]), <TierTimeline />));
    expect(screen.getByText(/No function got hot enough to tier up/)).toBeTruthy();
    expect(within(panel("V8 would typically tier up here")).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("badges the panel Modeled and spells out the tier order", () => {
    render(ui(withTracks([track(1)]), <TierTimeline />));
    expect(panelBadge("V8 would typically tier up here")).toContain(TRUTH_TOOLTIPS.modeled);
    expect(screen.getByText("Ignition → Sparkplug → Maglev → TurboFan")).toBeTruthy();
  });

  it("marks a deopt with its reason in words and a playhead at the current tick", () => {
    const store = withTracks([track(1, { deopts: [{ index: 6, reason: "kWrongMap" }] })]);
    seek(store, 2);
    const { container } = render(ui(store, <TierTimeline />));
    const marker = screen.getByRole("img", { name: "Deoptimized: wrong map" });
    expect(marker.getAttribute("tabindex")).toBe("0");
    expect(marker.querySelector("title")?.textContent).toBe("wrong map");
    expect(container.querySelectorAll("[data-playhead]")).toHaveLength(1);
  });

  it("summarises functions and deopts in the header", () => {
    render(ui(withTracks([track(1, { deopts: [{ index: 6, reason: "kOverflow" }] }), track(2)]), <TierTimeline />));
    expect(within(panel("V8 would typically tier up here")).getByText("2 functions · 1 deopt")).toBeTruthy();
  });
});

describe("V8InternalsView", () => {
  it("composes the panels into their named slots", () => {
    const store = readyStore("hidden-classes-shapes");
    seek(store, last(store));
    const { container } = render(ui(store, <V8InternalsView />));
    expect(panel("Frame")).toBeTruthy();
    expect(panel("Inline caches")).toBeTruthy();
    expect(panel("Elements kinds")).toBeTruthy();
    for (const [slot, name] of [
      ["hidden-classes", "Hidden classes"],
      ["heap", "Heap"],
      ["tiers", "V8 would typically tier up here"],
    ] as const) {
      expect(within(container.querySelector(`[data-slot="${slot}"]`) as HTMLElement).getByRole("region", { name })).toBeTruthy();
    }
  });
});
