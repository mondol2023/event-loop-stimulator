// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PreferencesContext } from "@/features/preferences/PreferencesProvider";
import { PlaygroundStoreContext } from "../store/PlaygroundContext";
import { createPlaygroundStore } from "../store/playgroundStore";
import { runSource } from "../test/fixtureTimeline";
import { PlaygroundShell } from "./PlaygroundShell";

// The panes load through next/dynamic, which needs a bundler; here they are the real components, imported directly.
vi.mock("./lazy", async () => {
  const { BytecodePane } = await import("./panes/BytecodePane");
  const { V8InternalsView } = await import("@/features/v8-internals/components/V8InternalsView");
  const nothing = () => null;
  return {
    BytecodePaneLazy: BytecodePane,
    V8InternalsViewLazy: V8InternalsView,
    SourceEditorLazy: nothing,
    AstPaneLazy: nothing,
    MachineCodePaneLazy: nothing,
    HardwareViewLazy: nothing,
    EventLoopViewLazy: nothing,
    CoachMarksLazy: nothing,
  };
});

afterEach(cleanup);

beforeAll(() => {
  // jsdom has no layout and no media queries.
  Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
});

// Radix tabs activate on mouse down, not on click.
const pickTab = (name: string): boolean => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });

function shell() {
  const store = createPlaygroundStore();
  for (const response of runSource("const o = {};\no.x = 1;\nconsole.log(o.x);", 1)) store.getState().applyPipelineEvent({ kind: "response", response });
  const prefs = { theme: "dark" as const, mode: "self-study" as const, setTheme: () => undefined, setMode: () => undefined };
  render(
    <PreferencesContext.Provider value={prefs}>
      <PlaygroundStoreContext.Provider value={store}>
        <PlaygroundShell />
      </PlaygroundStoreContext.Provider>
    </PreferencesContext.Provider>,
  );
  return store;
}

describe("PlaygroundShell: feedback slot links", () => {
  it("clicking a bytecode [n] operand opens V8 Internals, expands the run panel and shows the Run segment", () => {
    const store = shell();
    // Start from the state a learner could be in: another bottom tab, the run panel collapsed, the Code segment.
    fireEvent.click(screen.getByRole("radio", { name: "Code" }));
    pickTab("Bytecode");
    fireEvent.click(screen.getByRole("button", { name: "Collapse the run panel" }));
    expect(screen.getByRole("button", { name: "Expand the run panel" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("tab", { name: "V8 Internals" }).getAttribute("aria-selected")).toBe("false");

    const link = document.querySelector<HTMLElement>(".cm-sl-slot-link[data-function-id='0'][data-slot='0']");
    expect(link).not.toBeNull();
    fireEvent.click(link as HTMLElement);

    expect(store.getState().focusSlot).toEqual({ functionId: 0, slot: 0 });
    expect(screen.getByRole("tab", { name: "V8 Internals" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Collapse the run panel" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("radio", { name: "Run" }).getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('tr[aria-selected="true"]')?.textContent).toContain("SetNamedSloppy");
  });

  it("opens the tab again when the same slot is chosen after the learner left it", () => {
    const store = shell();
    act(() => store.getState().focusFeedbackSlot({ functionId: 0 as never, slot: 0 }));
    expect(screen.getByRole("tab", { name: "V8 Internals" }).getAttribute("aria-selected")).toBe("true");
    pickTab("Event Loop");
    expect(screen.getByRole("tab", { name: "V8 Internals" }).getAttribute("aria-selected")).toBe("false");
    act(() => store.getState().focusFeedbackSlot({ functionId: 0 as never, slot: 0 }));
    expect(screen.getByRole("tab", { name: "V8 Internals" }).getAttribute("aria-selected")).toBe("true");
  });
});

