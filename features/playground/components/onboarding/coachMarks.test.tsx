// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoachMarks, placeCard } from "./CoachMarks";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("CoachMarks", () => {
  it("shows step 1 when the key is absent, and Next advances", () => {
    render(<CoachMarks />);
    expect(screen.getByRole("dialog", { name: /editor/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/hover/i)).toBeTruthy();
  });

  it("Esc dismisses and sets the key", () => {
    render(<CoachMarks />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("sl_onboarded")).toBe("1");
  });

  it("finishing on the last step sets the key", () => {
    render(<CoachMarks />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("sl_onboarded")).toBe("1");
  });

  it("renders nothing when the key is present", () => {
    localStorage.setItem("sl_onboarded", "1");
    render(<CoachMarks />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows once and never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<CoachMarks />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    vi.restoreAllMocks();
  });

  it("ignores an Escape another dialog already handled", () => {
    render(<CoachMarks />);
    const handled = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(localStorage.getItem("sl_onboarded")).toBeNull();
  });

  it("Back to the first step hands focus to Next", () => {
    render(<CoachMarks />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" }));
  });

  it("places the card from its measured height", () => {
    // jsdom has no layout: give the card a height far above the 170 px estimate (Classroom type, 44 px buttons).
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width: 320, height: 400 }));
    render(<CoachMarks />);
    const card = screen.getByRole("dialog");
    // Unanchored (no target in the DOM): bottom-centred, with its whole height above the viewport's bottom.
    expect(Number.parseFloat(card.style.top) + 400).toBeLessThanOrEqual(window.innerHeight - 8);
    rect.mockRestore();
  });
});

describe("placeCard", () => {
  const VW = 375;
  const VH = 667;
  const H = 215;
  const W = 320;
  const inside = ({ top, left }: { top: number; left: number }): void => {
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + H).toBeLessThanOrEqual(VH - 8);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + W).toBeLessThanOrEqual(VW - 8);
  };

  it("keeps a tall card on screen when the target fills the viewport", () => {
    inside(placeCard({ top: 90, left: 0, width: VW, height: VH - 90 }, VW, VH, W, H));
  });

  it("keeps it on screen for a target pinned to the bottom (the playback bar)", () => {
    const at = placeCard({ top: VH - 160, left: 0, width: VW, height: 160 }, VW, VH, W, H);
    inside(at);
    expect(at.top + H).toBeLessThanOrEqual(VH - 160);
  });

  it("keeps it on screen unanchored and for a target near the top", () => {
    inside(placeCard(null, VW, VH, W, H));
    inside(placeCard({ top: 40, left: 0, width: VW, height: 200 }, VW, VH, W, H));
  });

  it("puts it below a short target when there is room, without covering it", () => {
    const at = placeCard({ top: 40, left: 0, width: 1280, height: 380 }, 1280, 800, W, H);
    expect(at.top).toBeGreaterThanOrEqual(40 + 380);
  });
});
