import { expect, test as base, type Locator, type Page } from "@playwright/test";

/**
 * Shared by the Phase 6 specs. `test` extends Playwright's with an automatic `problems` fixture: it marks
 * the coach marks as seen (the tour is covered by its own unit tests; here it would cover the page), collects
 * every Content Security Policy console message and every uncaught page error, and fails the test at the end
 * if there was any.
 */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem("sl_onboarded", "1");
        } catch {
          // Blocked storage: the tour shows, which the specs below tolerate by not depending on it.
        }
      });
      page.on("console", (m) => {
        if (/Content Security Policy/i.test(m.text())) problems.push(`csp: ${m.text()}`);
      });
      page.on("pageerror", (e) => problems.push(`pageerror: ${String(e)}`));
      await use(problems);
      expect(problems, "CSP messages and page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const status = (page: Page): Locator => page.getByTestId("status");
export const consoleOutput = (page: Page): Locator => page.getByTestId("console");
export const tickReadout = (page: Page, tick: number, of: number): Locator => page.getByText(`Tick ${tick} / ${of}`, { exact: true });

/** The pipeline has produced a timeline for the current source. */
export async function waitForReady(page: Page): Promise<void> {
  await expect(status(page)).toHaveText("Ready", { timeout: 30_000 });
}

/** Opens /playground and waits for the default example's first run. */
export async function openPlayground(page: Page): Promise<void> {
  await page.goto("/playground");
  await expect(page.getByRole("heading", { level: 1, name: "Playground" })).toBeAttached();
  await waitForReady(page);
}

/**
 * Waits for the run that an edit just caused. The status leaves "Ready" once the 400 ms debounce fires, so a
 * bare wait for "Ready" can return on the previous program's run; the leave is skipped only when the edit
 * changed nothing.
 */
export async function waitForRunAfterEdit(page: Page): Promise<void> {
  await page
    .waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent !== "Ready", null, { polling: "raf", timeout: 3_000 })
    .catch(() => undefined);
  await waitForReady(page);
}

/** Loads an example through the Examples menu and waits for its run (see waitForRunAfterEdit). */
export async function loadExample(page: Page, title: string | RegExp): Promise<void> {
  await page.getByRole("button", { name: "Examples" }).click();
  await page.getByRole("menuitem", { name: title }).click();
  await waitForRunAfterEdit(page);
}

/** Selects a tab of the run panel ("Event Loop", "V8 Internals" or "Hardware") and waits for it to be the selected one. */
export async function openBottomTab(page: Page, name: "Event Loop" | "V8 Internals" | "Hardware"): Promise<void> {
  const tab = page.getByRole("tablist", { name: "Run views" }).getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Moves focus to the page body so the global playback shortcuts apply (they leave editors and widgets alone). */
export async function focusPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

type ShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };
type ShiftWindow = { __cls: number; __clsObserver: PerformanceObserver };

/** Starts summing layout shifts the browser reports without recent input; `buffered` includes earlier ones. */
export async function installLayoutShiftObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as ShiftWindow;
    w.__cls = 0;
    const add = (entries: PerformanceEntryList): void => {
      for (const entry of entries) {
        const shift = entry as ShiftEntry;
        if (!shift.hadRecentInput) w.__cls += shift.value;
      }
    };
    w.__clsObserver = new PerformanceObserver((list) => add(list.getEntries()));
    w.__clsObserver.observe({ type: "layout-shift", buffered: true });
    (w as unknown as { __clsAdd: typeof add }).__clsAdd = add;
  });
}

export async function readLayoutShift(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as ShiftWindow & { __clsAdd: (entries: PerformanceEntryList) => void };
    // Entries the observer has not delivered yet.
    w.__clsAdd(w.__clsObserver.takeRecords());
    return w.__cls;
  });
}
