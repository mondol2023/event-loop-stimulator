// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EXAMPLES } from "../../examples";
import { PlaygroundStoreContext } from "../../store/PlaygroundContext";
import { createPlaygroundStore, type PlaygroundStore } from "../../store/playgroundStore";
import { ExamplesMenu } from "./ExamplesMenu";
import { VerifiedBadge } from "./VerifiedBadge";

// Radix popper and focus scopes read these browser APIs, which jsdom lacks.
beforeAll(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
  Object.assign(Element.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    scrollIntoView: () => {},
  });
});

afterEach(cleanup);

const byId = (id: string) => {
  const example = EXAMPLES.find((e) => e.id === id);
  if (!example) throw new Error(`no example ${id}`);
  return example;
};
const NEXT_TICK = byId("nexttick-vs-promise");
const PROMISE_VS_TIMEOUT = byId("promise-vs-settimeout");

function setup(source: string, extra?: ReactNode): PlaygroundStore {
  const store = createPlaygroundStore({ source });
  render(
    <PlaygroundStoreContext.Provider value={store}>
      <ExamplesMenu />
      <VerifiedBadge />
      {extra}
    </PlaygroundStoreContext.Provider>,
  );
  return store;
}

// Radix opens a menu on Enter from the trigger; jsdom has no real pointer sequence.
function openMenu(): void {
  fireEvent.keyDown(screen.getByRole("button", { name: /examples/i }), { key: "Enter" });
}

describe("ExamplesMenu", () => {
  it("lists all ten examples with their blurbs", async () => {
    setup("");
    openMenu();
    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(10);
    expect(items[1]?.textContent).toContain(NEXT_TICK.blurb);
  });

  it("asks before replacing edited code, and Cancel leaves the source unchanged", async () => {
    const store = setup("console.log('mine');");
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /nextTick vs Promise/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Replace your code with 'nextTick vs Promise'?" });
    expect(dialog).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(store.getState().editor.source).toBe("console.log('mine');");
  });

  it("replaces edited code with the example on Confirm, including its language", async () => {
    const store = setup("console.log('mine');");
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /nextTick vs Promise/ }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(store.getState().editor.source).toBe(NEXT_TICK.source));
    expect(store.getState().editor.lang).toBe(NEXT_TICK.lang);
  });

  it("replaces an example with another one without asking", async () => {
    const store = setup(PROMISE_VS_TIMEOUT.source);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /nextTick vs Promise/ }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(store.getState().editor.source).toBe(NEXT_TICK.source);
  });

  it("replaces an empty editor without asking", async () => {
    const store = setup("");
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /nextTick vs Promise/ }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(store.getState().editor.source).toBe(NEXT_TICK.source);
  });
});

describe("VerifiedBadge", () => {
  it("claims a match with the pinned runtime for a recorded example", () => {
    setup(NEXT_TICK.source);
    expect(screen.getByText("Matches Node v24.19.0 (V8 13.6.233.17-node.51)")).toBeTruthy();
    expect(screen.queryByText("Simulated by spec model")).toBeNull();
  });

  it("reads 'Simulated by spec model' once one character is appended", () => {
    const store = setup(NEXT_TICK.source);
    act(() => store.getState().setSource(`${NEXT_TICK.source}x`));
    expect(screen.getByText("Simulated by spec model")).toBeTruthy();
    expect(screen.queryByText(/Matches Node/)).toBeNull();
  });

  it("flags the nondeterministic example, and no other", () => {
    const nondeterministic = EXAMPLES.find((e) => e.nondeterministic);
    if (!nondeterministic) throw new Error("catalog has no nondeterministic example");
    setup(nondeterministic.source);
    expect(screen.getByText("Order not guaranteed in real Node")).toBeTruthy();
    cleanup();
    setup(NEXT_TICK.source);
    expect(screen.queryByText("Order not guaranteed in real Node")).toBeNull();
  });
});
