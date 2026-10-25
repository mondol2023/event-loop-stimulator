// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { useShortcuts } from "../../keyboard/useShortcuts";
import { PlaygroundStoreContext } from "../../store/PlaygroundContext";
import { createPlaygroundStore, PLAYBACK_SPEEDS, type PlaygroundStore } from "../../store/playgroundStore";
import { fixtureRun, runSource } from "../../test/fixtureTimeline";
import { NarrationLine } from "./NarrationLine";
import { PlaybackBar } from "./PlaybackBar";
import { Scrubber } from "./Scrubber";
import { StopNotice } from "./StopNotice";

afterEach(cleanup);

function apply(store: PlaygroundStore, responses: ReturnType<typeof runSource>): void {
  for (const response of responses) store.getState().applyPipelineEvent({ kind: "response", response });
}

function readyStore(): PlaygroundStore {
  const { compiled, simulated } = fixtureRun("nexttick-vs-promise");
  const store = createPlaygroundStore();
  apply(store, [compiled, simulated]);
  return store;
}

/** A run whose timers and immediates race in the main module: real Node orders them by process speed. */
function warningStore(): PlaygroundStore {
  const store = createPlaygroundStore();
  apply(store, runSource("setTimeout(() => console.log('t'), 0);\nsetImmediate(() => console.log('i'));", 1));
  return store;
}

function Shortcuts({ store }: { store: PlaygroundStore }): null {
  useShortcuts(store);
  return null;
}

function mount(store: PlaygroundStore, ui: React.ReactNode) {
  return render(
    <PlaygroundStoreContext.Provider value={store}>
      <Shortcuts store={store} />
      {ui}
    </PlaygroundStoreContext.Provider>,
  );
}

describe("Scrubber", () => {
  it("exposes slider semantics for the current tick", () => {
    const store = readyStore();
    mount(store, <Scrubber />);
    act(() => store.getState().seek(2));
    const slider = screen.getByRole("slider");
    const { length } = store.getState().playback;
    expect(slider.getAttribute("aria-valuemin")).toBe("0");
    expect(slider.getAttribute("aria-valuemax")).toBe(String(length - 1));
    expect(slider.getAttribute("aria-valuenow")).toBe("2");
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^Tick 3, \S+/);
  });

  it("moves exactly one tick per ArrowRight with the global shortcuts mounted", () => {
    const store = readyStore();
    mount(store, <Scrubber />);
    act(() => store.getState().seek(3));
    const slider = screen.getByRole("slider");
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(store.getState().playback.index).toBe(4);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(store.getState().playback.index).toBe(3);
  });

  it("jumps to the first and last tick with Home and End, and to job boundaries with Shift+arrows", () => {
    const store = readyStore();
    mount(store, <Scrubber />);
    const slider = screen.getByRole("slider");
    const { length } = store.getState().playback;
    fireEvent.keyDown(slider, { key: "End" });
    expect(store.getState().playback.index).toBe(length - 1);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(store.getState().playback.index).toBe(0);
    const [, secondBoundary] = store.getState().compile.boundaries;
    if (secondBoundary === undefined) throw new Error("expected at least two job boundaries");
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    expect(store.getState().playback.index).toBe(secondBoundary);
  });

  it("leaves keys with modifiers to the browser", () => {
    const store = readyStore();
    mount(store, <Scrubber />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight", ctrlKey: true });
    expect(store.getState().playback.index).toBe(0);
  });

  it("seeks to the pointer position on the track and while dragging", () => {
    const store = readyStore();
    mount(store, <Scrubber />);
    const { length } = store.getState().playback;
    const slider = screen.getByRole("slider");
    slider.getBoundingClientRect = () => ({ left: 100, width: 200, right: 300, top: 0, bottom: 10, height: 10, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(slider, { clientX: 200, pointerId: 1, button: 0 });
    expect(store.getState().playback.index).toBe(Math.round((length - 1) / 2));
    fireEvent.pointerMove(slider, { clientX: 300, pointerId: 1 });
    expect(store.getState().playback.index).toBe(length - 1);
    fireEvent.pointerUp(slider, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 100, pointerId: 1 });
    expect(store.getState().playback.index).toBe(length - 1);
  });

  it("positions the thumb through the DOM, not a server-rendered style", () => {
    const store = readyStore();
    mount(store, <Scrubber />);
    const { length } = store.getState().playback;
    act(() => store.getState().seek(length - 1));
    expect(screen.getByTestId("scrubber-thumb").style.left).toBe("100%");
    act(() => store.getState().seek(0));
    expect(screen.getByTestId("scrubber-thumb").style.left).toBe("0%");
  });

  it("renders one marker per compile.markers entry, with warnings readable as text", () => {
    const store = warningStore();
    const { markers } = store.getState().compile;
    const warnings = markers.filter((m) => m.kind === "warning");
    expect(warnings.length).toBeGreaterThan(0);
    mount(store, <Scrubber />);
    expect(document.querySelectorAll("[data-marker]")).toHaveLength(markers.length);
    expect(document.querySelectorAll("[data-marker='job']")).toHaveLength(markers.filter((m) => m.kind === "job").length);
    for (const w of warnings) {
      if (w.kind !== "warning") continue;
      expect(screen.getByRole("img", { name: w.message })).toBeTruthy();
    }
  });

  it("is inert with no timeline", () => {
    const store = createPlaygroundStore();
    mount(store, <Scrubber />);
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(store.getState().playback.index).toBe(0);
  });
});

describe("PlaybackBar", () => {
  it("disables every control at length 0", () => {
    mount(createPlaygroundStore(), <PlaybackBar />);
    const region = screen.getByRole("region", { name: "Playback" });
    const controls = [...within(region).queryAllByRole("button"), ...within(region).queryAllByRole("radio")];
    expect(controls.length).toBeGreaterThanOrEqual(7 + PLAYBACK_SPEEDS.length);
    for (const control of controls) expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(within(region).getByText("Tick 0 / 0")).toBeTruthy();
  });

  it("labels the seven transport buttons and one speed button per PLAYBACK_SPEEDS entry", () => {
    mount(readyStore(), <PlaybackBar />);
    for (const name of ["First tick", "Previous job", "Step back", "Play", "Step forward", "Next job", "Last tick"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    for (const speed of PLAYBACK_SPEEDS) expect(screen.getByRole("radio", { name: `${speed}×` })).toBeTruthy();
  });

  it("shows the tick counter and narrates the current tick politely", () => {
    const store = readyStore();
    mount(store, <PlaybackBar />);
    const { length } = store.getState().playback;
    expect(screen.getByText(`Tick 1 / ${length}`)).toBeTruthy();
    act(() => store.getState().seek(length - 1));
    expect(screen.getByText(`Tick ${length} / ${length}`)).toBeTruthy();
    const narration = screen.getByRole("status", { name: "Narration" });
    expect(narration.getAttribute("aria-live")).toBe("polite");
    expect(narration.textContent).not.toBe("");
  });

  it("drives the store from its buttons", () => {
    const store = readyStore();
    mount(store, <PlaybackBar />);
    fireEvent.click(screen.getByRole("button", { name: "Step forward" }));
    expect(store.getState().playback.index).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Last tick" }));
    expect(store.getState().playback.index).toBe(store.getState().playback.length - 1);
    fireEvent.click(screen.getByRole("button", { name: "First tick" }));
    expect(store.getState().playback.index).toBe(0);
    fireEvent.click(screen.getByRole("radio", { name: "4×" }));
    expect(store.getState().playback.speed).toBe(4);
  });

  it("toggles play once for a Space press on the Play button", () => {
    const store = readyStore();
    mount(store, <PlaybackBar />);
    const changes: boolean[] = [];
    store.subscribe(
      (s) => s.playback.isPlaying,
      (isPlaying) => changes.push(isPlaying),
    );
    const play = screen.getByRole("button", { name: "Play" });
    play.focus();
    // A browser activates a button on Space keyup by firing a click; jsdom does not, so it is replayed here.
    // The global Space shortcut must stay out of the way, or the toggle would happen twice.
    fireEvent.keyDown(play, { key: " " });
    fireEvent.keyUp(play, { key: " " });
    fireEvent.click(play);
    expect(changes).toEqual([true]);
    expect(store.getState().playback.isPlaying).toBe(true);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("renders no style attribute on the server", () => {
    const html = renderToString(
      <PlaygroundStoreContext.Provider value={readyStore()}>
        <PlaybackBar />
      </PlaygroundStoreContext.Provider>,
    );
    expect(html).not.toMatch(/\sstyle="/);
  });

  it("shows the stop notice when the run hit a limit", () => {
    const store = createPlaygroundStore();
    apply(store, runSource("while (true) {}", 1));
    expect(store.getState().compile.stop).not.toBeNull();
    mount(store, <PlaybackBar />);
    expect(screen.getByText("Simulation limit reached — real Node would continue")).toBeTruthy();
  });
});

describe("StopNotice", () => {
  it("renders the notice and the limit name", () => {
    render(<StopNotice stop={{ kind: "limit", limit: "ticks" }} />);
    expect(screen.getByText("Simulation limit reached — real Node would continue")).toBeTruthy();
    expect(screen.getByText("ticks")).toBeTruthy();
  });

  it("renders the reason for an unsupported construct", () => {
    render(<StopNotice stop={{ kind: "unsupported", reason: "label statements" }} />);
    expect(screen.getByText("Simulation limit reached — real Node would continue")).toBeTruthy();
    expect(screen.getByText("label statements")).toBeTruthy();
  });

  it("renders nothing for null", () => {
    const { container } = render(<StopNotice stop={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("NarrationLine", () => {
  it("is a polite live region even when empty", () => {
    mount(createPlaygroundStore(), <NarrationLine />);
    const region = screen.getByRole("status", { name: "Narration" });
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
  });
});
