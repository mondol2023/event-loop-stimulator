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
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(await screen.findByText("Go to tick…"));
    const input = await screen.findByPlaceholderText(/tick number/i);
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(await screen.findByText("Go to tick 5"));
    await waitFor(() => expect(seek).toHaveBeenCalledWith(4));
  });
});
