// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ConsolePanel } from "@/features/event-loop-2d/ConsolePanel";
import { PreferencesContext } from "@/features/preferences/PreferencesProvider";
import type { UsageMode } from "@/features/preferences/modes";
import { PlaygroundStoreContext } from "@/features/playground/store/PlaygroundContext";
import { createPlaygroundStore, type PlaygroundStore } from "@/features/playground/store/playgroundStore";
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
});
