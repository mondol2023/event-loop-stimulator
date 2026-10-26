// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PlaygroundStoreContext } from "../../store/PlaygroundContext";
import { createPlaygroundStore } from "../../store/playgroundStore";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { PaletteLauncher } from "./PaletteLauncher";

beforeAll(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
  Object.assign(Element.prototype, { scrollIntoView: () => {}, hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {} });
});
afterEach(cleanup);

function setup() {
  const store = createPlaygroundStore({ source: "console.log(1);" });
  const seek = vi.fn();
  store.setState({ seek });
  render(
    <PreferencesProvider initial={{ theme: "dark", mode: "self-study", themeExplicit: false }}>
      <PlaygroundStoreContext.Provider value={store}>
        <PaletteLauncher onShowHardware={() => {}} />
      </PlaygroundStoreContext.Provider>
    </PreferencesProvider>,
  );
  return { seek };
}

describe("PaletteLauncher", () => {
  it("opens on Ctrl+K and Go to tick seeks to n-1", async () => {
    const { seek } = setup();
    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    fireEvent.click(await screen.findByText("Go to tick…"));
    const input = await screen.findByPlaceholderText(/tick number/i);
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(await screen.findByText("Go to tick 5"));
    await waitFor(() => expect(seek).toHaveBeenCalledWith(4));
  });

  it("reopens on the root page with an empty search after a command", async () => {
    setup();
    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    fireEvent.click(await screen.findByText("Go to tick…"));
    fireEvent.change(await screen.findByPlaceholderText(/tick number/i), { target: { value: "5" } });
    fireEvent.click(await screen.findByText("Go to tick 5"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    expect(await screen.findByText("Go to tick…")).toBeTruthy();
    expect((screen.getByPlaceholderText(/type a command/i) as HTMLInputElement).value).toBe("");
  });

  it("does not open over another open modal", async () => {
    setup();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("data-state", "open");
    document.body.append(modal);
    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByPlaceholderText(/type a command/i)).toBeNull();
    modal.remove();
  });

  it("still keeps the browser's Ctrl+K from firing under another modal", () => {
    setup();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("data-state", "open");
    document.body.append(modal);
    const chord = new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, cancelable: true, bubbles: true });
    window.dispatchEvent(chord);
    expect(chord.defaultPrevented).toBe(true);
    modal.remove();
  });
});
