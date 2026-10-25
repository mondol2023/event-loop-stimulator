import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, loadExample, openPlayground, test } from "./helpers/playground";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  // The message names every offending node, so a failure says what to fix.
  return results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`) }));
}

test.beforeEach(async ({ page }) => {
  await openPlayground(page);
  await loadExample(page, /^nextTick vs Promise/);
});

/** Past the first tick, so the queues, the call stack and the narration have content to check. */
async function stepIntoTheRun(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Next job" }).click();
  await expect(page.getByText(/^Tick [2-9]\d* \/ \d+$/)).toBeVisible();
}

test("the first tick, with an empty console, has no accessibility violations", async ({ page }) => {
  await expect(page.getByText("No output yet.")).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("the loaded example in the dark theme has no accessibility violations", async ({ page }) => {
  await stepIntoTheRun(page);
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await violations(page)).toEqual([]);
});

test("the loaded example in the light theme has no accessibility violations", async ({ page }) => {
  await stepIntoTheRun(page);
  await page.keyboard.press("ControlOrMeta+K");
  await page.getByRole("option", { name: "Theme: Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
  expect(await violations(page)).toEqual([]);
});

test("the command palette open has no accessibility violations", async ({ page }) => {
  await stepIntoTheRun(page);
  await page.keyboard.press("ControlOrMeta+K");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Run" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
