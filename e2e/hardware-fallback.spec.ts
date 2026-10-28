import { expect, loadExample, openBottomTab, openPlayground, test } from "./helpers/playground";

// Runs in the `no-webgl` project (playwright.config.ts): Chromium is launched with --disable-webgl and --disable-3d-apis.

test("without WebGL the Hardware tab shows the 2D board, says why, and draws no canvas", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await openPlayground(page);
  await loadExample(page, /^recursive factorial/);
  await openBottomTab(page, "Hardware");

  const board = page.getByRole("group", { name: "2D hardware board" });
  await expect(board).toBeVisible();
  await expect(board.getByText("rax", { exact: true })).toBeVisible();
  await expect(board.getByText("accumulator", { exact: true })).toBeVisible();
  await expect(page.getByText("3D unavailable; showing the 2D board")).toBeVisible();
  await expect(page.getByRole("group", { name: "Board view", exact: true }).getByRole("button", { name: "2D", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-slot="hardware-view"] canvas')).toHaveCount(0);

  // Asking for 3D re-probes WebGL, finds none and stays on the 2D board.
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(board).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);

  expect(errors, "console errors").toEqual([]);
});
