// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaygroundStore } from "../store/playgroundStore";
import { useShortcuts } from "./useShortcuts";

afterEach(cleanup);

function Probe({ store }: { store: ReturnType<typeof createPlaygroundStore> }) {
  useShortcuts(store);
  return null;
}

describe("useShortcuts with a modal open", () => {
  it("leaves playback keys alone while a dialog is open, and drives them again once it closes", () => {
    const store = createPlaygroundStore({ source: "" });
    const togglePlay = vi.fn();
    store.setState({ togglePlay });
    render(<Probe store={store} />);
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("data-state", "open");
    document.body.append(modal);
    fireEvent.keyDown(document.body, { key: " " });
    expect(togglePlay).not.toHaveBeenCalled();
    modal.remove();
    fireEvent.keyDown(document.body, { key: " " });
    expect(togglePlay).toHaveBeenCalledTimes(1);
  });

  it("keeps playback keys live while the non-modal More playback popover is open", () => {
    const store = createPlaygroundStore({ source: "" });
    const togglePlay = vi.fn();
    store.setState({ togglePlay });
    render(<Probe store={store} />);
    const popover = document.createElement("div");
    popover.setAttribute("role", "dialog");
    popover.setAttribute("data-state", "open");
    popover.setAttribute("data-slot", "popover-content");
    document.body.append(popover);
    fireEvent.keyDown(document.body, { key: " " });
    expect(togglePlay).toHaveBeenCalledTimes(1);
    popover.remove();
  });
});
