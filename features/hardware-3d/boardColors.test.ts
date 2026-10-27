// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardColors, createBoardTheme } from "./board/boardColors";

const style = document.createElement("style");
style.textContent = ":root { --card: #fff; --primary: #15803d; } html.dark { --card: #151e33; --primary: #22c55e; }";
document.head.append(style);

afterEach(() => document.documentElement.classList.remove("dark"));

describe("boardColors", () => {
  it("reads tokens from the page, shortened hex included, and falls back to dark values for a missing one", () => {
    const colors = boardColors();
    expect(colors.card.getHexString()).toBe("ffffff");
    expect(colors.current.getHexString()).toBe("15803d");
    expect(colors.background.getHexString()).toBe("0b1120");
  });

  it("re-reads every token in place when <html> changes class, then tells listeners and asks for a frame", async () => {
    const invalidate = vi.fn();
    const theme = createBoardTheme(invalidate);
    const card = theme.colors.card;
    const listener = vi.fn();
    theme.subscribe(listener);
    const stop = theme.connect();
    expect(card.getHexString()).toBe("ffffff");

    document.documentElement.classList.add("dark");
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(theme.colors.card).toBe(card);
    expect(card.getHexString()).toBe("151e33");
    expect(theme.colors.current.getHexString()).toBe("22c55e");
    expect(invalidate).toHaveBeenCalled();

    stop();
    document.documentElement.classList.remove("dark");
    await new Promise((r) => setTimeout(r, 20));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
