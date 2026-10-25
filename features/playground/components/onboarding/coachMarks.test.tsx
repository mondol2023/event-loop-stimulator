// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoachMarks } from "./CoachMarks";

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
});
