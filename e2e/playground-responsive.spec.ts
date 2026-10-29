import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, loadExample, openPlayground, test } from "./helpers/playground";

const WIDTHS = [375, 768, 1280, 1440] as const;
const SHOTS = join(process.cwd(), "test-results", "phase6");

const overflow = (page: Page): Promise<{ scrollWidth: number; innerWidth: number }> =>
  page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));

async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await overflow(page);
  expect(scrollWidth, `${where}: scrollWidth ${scrollWidth} within innerWidth ${innerWidth}`).toBeLessThanOrEqual(innerWidth);
}

for (const width of WIDTHS) {
  test(`at ${width} px the page does not scroll sideways and shows its region layout`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 812 : 800 });
    await openPlayground(page);
    await loadExample(page, /^nextTick vs Promise/);
    await page.getByRole("button", { name: "Next job" }).click();

    const editor = page.getByRole("region", { name: "Editor" });
    const compiled = page.getByRole("tablist", { name: "Compiled views" });
    const run = page.getByRole("tablist", { name: "Run views" });
    const segments = page.getByRole("radiogroup", { name: "Playground section" });
    const hardware = page.getByRole("tab", { name: "Hardware" });
    await expectNoHorizontalScroll(page, "editor");

    if (width < 1024) {
      // One region at a time behind the segmented control.
      await expect(segments).toBeVisible();
      await expect(editor).toBeVisible();
      await expect(compiled).toBeHidden();
      await expect(run).toBeHidden();

      await segments.getByRole("radio", { name: "Code" }).click();
      await expect(compiled).toBeVisible();
      await expect(editor).toBeHidden();
      await expectNoHorizontalScroll(page, "code");

      await segments.getByRole("radio", { name: "Run" }).click();
      await expect(run).toBeVisible();
      await expect(compiled).toBeHidden();
      await expect(page.getByTestId("region-microtask")).toBeVisible();
      await expectNoHorizontalScroll(page, "run");

      // The Hardware tab is offered at every width (Phase 7, D5 and ADR-066); with no stored choice a phone opens it on the 2D board.
      await expect(hardware).toBeVisible();
      if (width < 768) {
        await hardware.click();
        await expect(page.getByRole("group", { name: "2D hardware board" })).toBeVisible();
        await expect(page.locator('[data-slot="hardware-view"] canvas')).toHaveCount(0);
        await expectNoHorizontalScroll(page, "hardware");
      }
    } else {
      // The three regions side by side and stacked: editor, compiled views and run, with the playback bar under them.
      await expect(segments).toBeHidden();
      await expect(editor).toBeVisible();
      await expect(compiled).toBeVisible();
      await expect(run).toBeVisible();
      await expect(hardware).toBeVisible();
      const [e, c, r] = await Promise.all([editor.boundingBox(), compiled.boundingBox(), run.boundingBox()]);
      expect(e && c && r, "all three regions have a box").toBeTruthy();
      if (e && c && r) {
        expect(c.x, "compiled views sit to the right of the editor").toBeGreaterThan(e.x + e.width - 1);
        expect(r.y, "the run panel sits below both").toBeGreaterThan(Math.max(e.y, c.y));
      }
    }
    await expect(page.getByRole("region", { name: "Playback" })).toBeVisible();

    // Back on the first segment for the screenshot, so every width shows the same starting view.
    if (width < 1024) await segments.getByRole("radio", { name: "Editor" }).click();
    await expectNoHorizontalScroll(page, "final");

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${width}.png`), fullPage: true });
  });
}
