// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResizableSplit } from "./ResizableSplit";

afterEach(cleanup);

describe("ResizableSplit separator keys", () => {
  it.each([
    ["ArrowRight", "52"],
    ["ArrowLeft", "48"],
    ["Home", "20"],
    ["End", "80"],
  ])("%s resizes the split and does not reach window listeners", (key, expected) => {
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    try {
      render(
        <ResizableSplit orientation="horizontal" label="Resize panes" first="a" second="b" defaultPercent={50} />,
      );
      const handle = screen.getByRole("separator", { name: "Resize panes" });
      const notCancelled = fireEvent.keyDown(handle, { key });
      expect(notCancelled).toBe(false); // preventDefault was called
      expect(handle.getAttribute("aria-valuenow")).toBe(expected);
      expect(onWindowKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKeyDown);
    }
  });

  it("lets unrelated keys bubble to window", () => {
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    try {
      render(<ResizableSplit orientation="horizontal" label="Resize panes" first="a" second="b" defaultPercent={50} />);
      fireEvent.keyDown(screen.getByRole("separator"), { key: "x" });
      expect(onWindowKeyDown).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", onWindowKeyDown);
    }
  });
});
