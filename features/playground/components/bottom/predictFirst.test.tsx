// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ConsolePanel } from "@/features/event-loop-2d/ConsolePanel";
import { PreferencesContext } from "@/features/preferences/PreferencesProvider";
import type { UsageMode } from "@/features/preferences/modes";
import { PlaygroundStoreContext } from "@/features/playground/store/PlaygroundContext";
import { createPlaygroundStore, type PlaygroundStore } from "@/features/playground/store/playgroundStore";
import { NarrationLine } from "@/features/playground/components/playback/NarrationLine";
import { getTimeline } from "@/features/playground/store/timelineHolder";
import { fixtureRun } from "@/features/playground/test/fixtureTimeline";

afterEach(cleanup);

const NAME = "nexttick-vs-promise";

function readyStore(): PlaygroundStore {
  const { compiled, simulated } = fixtureRun(NAME);
  const store = createPlaygroundStore();
  store.getState().applyPipelineEvent({ kind: "response", response: compiled });
  store.getState().applyPipelineEvent({ kind: "response", response: simulated });
  return store;
}

function ui(store: PlaygroundStore, mode: UsageMode): ReactElement {
  const prefs = {
    theme: "dark" as const,
    mode,
    setTheme: () => undefined,
    setMode: () => undefined,
  };
  return (
    <PreferencesContext.Provider value={prefs}>
      <PlaygroundStoreContext.Provider value={store}>
        <ConsolePanel />
        <NarrationLine />
      </PlaygroundStoreContext.Provider>
    </PreferencesContext.Provider>
  );
}

const last = (store: PlaygroundStore): number => store.getState().playback.length - 1;

describe("predict-first console", () => {
  it("hides the console at index 0 in interview mode and shows the prompt", () => {
    const store = readyStore();
    render(ui(store, "interview"));
    expect(screen.queryByTestId("console")).toBeNull();
    expect(screen.getByText("Predict the output, then reveal")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reveal" })).toBeTruthy();
  });

  it("shows the console after Reveal", () => {
    const store = readyStore();
    render(ui(store, "interview"));
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(screen.getByTestId("console")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reveal" })).toBeNull();
  });

  it("moves focus to the console after Reveal", () => {
    const store = readyStore();
    render(ui(store, "interview"));
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(document.activeElement).toBe(screen.getByTestId("console"));
  });

  it("shows the console once playback reaches the last tick", () => {
    const store = readyStore();
    render(ui(store, "interview"));
    act(() => store.getState().seek(last(store)));
    expect(screen.getByTestId("console")).toBeTruthy();
  });

  it("hides it again when a new job is compiled", () => {
    const store = readyStore();
    render(ui(store, "interview"));
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(screen.getByTestId("console")).toBeTruthy();
    const { compiled, simulated } = fixtureRun(NAME);
    act(() => {
      store.getState().applyPipelineEvent({
        kind: "response",
        response: { ...compiled, jobId: compiled.jobId + 1 },
      });
      store.getState().applyPipelineEvent({
        kind: "response",
        response: { ...simulated, jobId: simulated.jobId + 1 },
      });
    });
    expect(store.getState().playback.index).toBe(0);
    expect(screen.queryByTestId("console")).toBeNull();
    expect(screen.getByRole("button", { name: "Reveal" })).toBeTruthy();
  });

  it("always shows the console in self-study", () => {
    const store = readyStore();
    render(ui(store, "self-study"));
    expect(screen.getByTestId("console")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reveal" })).toBeNull();
  });

  it("keeps the output revealed after reaching the last tick and stepping back", () => {
    const store = readyStore();
    render(ui(store, "interview"));
    act(() => store.getState().seek(last(store)));
    act(() => store.getState().seek(last(store) - 1));
    expect(screen.getByTestId("console")).toBeTruthy();
    act(() => store.getState().seek(0));
    expect(screen.getByTestId("console")).toBeTruthy();
  });

  it("keeps the narration from quoting the output until Reveal", () => {
    const store = readyStore();
    const timeline = getTimeline(store);
    if (!timeline) throw new Error("no timeline");
    let at = -1;
    for (let i = 1; i < last(store); i++)
      if (timeline.at(i).console.length > timeline.at(i - 1).console.length) {
        at = i;
        break;
      }
    expect(at, "a tick that prints before the end").toBeGreaterThan(0);
    // The narration quotes the line with escapes, like `sync 1\n`.
    const text = JSON.stringify(timeline.at(at).console[timeline.at(at - 1).console.length]?.text ?? "").slice(1, -1);
    render(ui(store, "interview"));
    act(() => store.getState().seek(at));
    // Without Reveal the sentence is gone; guard that the fixture's narration does quote it.
    expect(timeline.at(at).narration).toContain(text);
    const narration = screen.getByRole("status", { name: "Narration" });
    expect(narration.textContent).not.toContain(text);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(narration.textContent).toContain(text);
  });
});
