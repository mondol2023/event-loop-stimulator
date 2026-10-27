// @vitest-environment jsdom
import { Suspense, lazy, type ComponentType } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webgl = vi.hoisted(() => ({ available: true }));

vi.mock("./webgl", () => ({ hasWebGL: () => webgl.available }));
// The real canvas pulls in three; the test only needs an element that can lose its context.
vi.mock("./board/HardwareCanvas", () => ({ default: () => <canvas data-testid="hw-canvas" /> }));
vi.mock("./SvgBoard", () => ({ default: () => <svg role="img" aria-label="2D hardware board" /> }));
// next/dynamic needs Next's loadable runtime; React.lazy is the same contract for these tests.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: ComponentType } | ComponentType>) => {
    const Lazy = lazy(async () => {
      const m = await loader();
      return { default: "default" in m ? m.default : m };
    });
    return function Dynamic() {
      return (
        <Suspense fallback={null}>
          <Lazy />
        </Suspense>
      );
    };
  },
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

import { HardwareView } from "./HardwareView";

function stubStorage(impl: Partial<Storage>) {
  vi.stubGlobal("localStorage", impl);
  Object.defineProperty(window, "localStorage", { configurable: true, value: impl });
}

describe("HardwareView", () => {
  beforeEach(() => {
    webgl.available = true;
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the SVG board and the notice when WebGL is unavailable", async () => {
    webgl.available = false;
    render(<HardwareView />);
    expect(await screen.findByRole("img", { name: "2D hardware board" })).toBeTruthy();
    expect(screen.getByText("3D unavailable; showing the 2D board")).toBeTruthy();
    expect(screen.queryByTestId("hw-canvas")).toBeNull();
  });

  it("switches to the 2D board when the canvas loses its WebGL context", async () => {
    render(<HardwareView />);
    const canvas = await screen.findByTestId("hw-canvas");
    expect(screen.getByRole("button", { name: "3D" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent(canvas, new Event("webglcontextlost", { bubbles: false, cancelable: true }));

    expect(await screen.findByRole("img", { name: "2D hardware board" })).toBeTruthy();
    expect(screen.getByText("3D unavailable; showing the 2D board")).toBeTruthy();
    expect(screen.getByRole("button", { name: "2D" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("hw-canvas")).toBeNull();
  });

  it("keeps the toggle working for the session when localStorage throws", async () => {
    const boom = () => {
      throw new DOMException("denied", "SecurityError");
    };
    stubStorage({ getItem: boom, setItem: boom, removeItem: boom, clear: boom });
    render(<HardwareView />);
    await screen.findByTestId("hw-canvas");

    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    expect(await screen.findByRole("img", { name: "2D hardware board" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "2D" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("3D unavailable; showing the 2D board")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() => expect(screen.getByTestId("hw-canvas")).toBeTruthy());
    expect(screen.getByRole("button", { name: "3D" }).getAttribute("aria-pressed")).toBe("true");
  });
});
