import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, loadExample, openBottomTab, openPlayground, test, tickReadout } from "./helpers/playground";

// Every expectation here is read from the natives twin's recording on real Node (tests/conformance/internals/*.expected.json):
// `%HaveSameMap` and the elements kind come from V8 itself, so nothing about the probes is written into this file.

// One worker runs this file's tests one after another: the long-task checks below time the main thread, and a second browser rendering in
// software at the same moment starves it (measured: 150 to 330 ms "long tasks" in either mode only when tests overlapped).
test.describe.configure({ mode: "serial" });

const INTERNALS = join(process.cwd(), "tests", "conformance", "internals");

type Probe = {
  /** The probe's number, as `probe <n>` printed it. */
  readonly n: number;
  /** What real Node printed after `probe <n>`: `true`/`false` or an elements kind. */
  readonly value: string;
  /** How many of the example's own `console.log` calls come before the probe in the source; the probe follows the last of them. */
  readonly callsBefore: number;
};

/** The probes of a twin: the recorded values from its stdout, and where each sits among the example's console.log calls (from the source). */
function probesOf(fixture: string): Probe[] {
  const recorded = JSON.parse(readFileSync(join(INTERNALS, `${fixture}.expected.json`), "utf8")) as { outcomes: { stdout: string }[] };
  const stdout = recorded.outcomes[0]?.stdout ?? "";
  const printed = new Map<number, string>();
  for (const line of stdout.split("\n")) {
    const m = /^probe (\d+) (.+)$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) printed.set(Number(m[1]), m[2]);
  }
  const probes: Probe[] = [];
  let calls = 0;
  for (const line of readFileSync(join(INTERNALS, `${fixture}.cjs`), "utf8").split("\n")) {
    const probe = /^console\.log\("probe (\d+)"/.exec(line);
    if (probe?.[1] !== undefined) {
      const n = Number(probe[1]);
      const value = printed.get(n);
      if (value === undefined) throw new Error(`${fixture}: probe ${n} has no recorded value`);
      probes.push({ n, value, callsBefore: calls });
    } else if (line.startsWith("console.log(")) {
      calls++;
    }
  }
  expect(probes.length, `${fixture}: probes found in the twin`).toBeGreaterThan(0);
  expect(probes.length, `${fixture}: probes recorded`).toBe(printed.size);
  return probes;
}

const timeline = (page: Page): Locator => page.getByRole("slider", { name: "Timeline" });

async function tickCount(page: Page): Promise<number> {
  return Number(await timeline(page).getAttribute("aria-valuemax")) + 1;
}

/** Seeks to the tick with this 0-based index through the slider's own keys, then waits for the readout. */
async function seekTo(page: Page, index: number): Promise<void> {
  const total = await tickCount(page);
  await timeline(page).focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < index; i++) await page.keyboard.press("ArrowRight");
  await expect(tickReadout(page, index + 1, total)).toBeVisible();
}

/**
 * The 0-based tick at which each new piece of console output first shows, one entry per `console.log` call that prints,
 * found by stepping through the run on the Event Loop tab (the console lives there).
 */
async function consoleOutputTicks(page: Page): Promise<number[]> {
  await openBottomTab(page, "Event Loop");
  const total = await tickCount(page);
  await timeline(page).focus();
  await page.keyboard.press("Home");
  await expect(tickReadout(page, 1, total)).toBeVisible();
  const ticks: number[] = [];
  let seen = (await page.getByTestId("console").textContent()) ?? "";
  for (let i = 1; i < total; i++) {
    await page.keyboard.press("ArrowRight");
    await expect(tickReadout(page, i + 1, total)).toBeVisible();
    const now = (await page.getByTestId("console").textContent()) ?? "";
    if (now !== seen) {
      ticks.push(i);
      seen = now;
    }
  }
  return ticks;
}

test.describe("V8 Internals follow the recorded V8", () => {
  test.beforeEach(async ({ page }) => {
    await openPlayground(page);
  });

  test("hidden classes: two objects show the same Map iff real V8 says they share one", async ({ page }) => {
    const probes = probesOf("hidden-classes-shapes-natives");
    await loadExample(page, /^hidden classes: same shape vs different order/);
    const outputTicks = await consoleOutputTicks(page);
    await openBottomTab(page, "V8 Internals");

    // The example declares `Point`, then a, b, sameOrder, otherOrder: they sit in r1..r4, and probe 3 asks again about a and b.
    const REGISTERS_OF_PAIR: Record<number, readonly [string, string]> = { 1: ["r1", "r2"], 2: ["r3", "r4"], 3: ["r1", "r2"] };
    const frame = page.locator('[data-slot="frame"]');
    const mapOf = async (register: string): Promise<string> => {
      const row = frame.getByRole("row").filter({ has: page.getByRole("rowheader", { name: register, exact: true }) });
      const chip = row.getByText(/^Map#\d+$/);
      await expect(chip, `${register} holds an object`).toBeVisible();
      return (await chip.textContent()) ?? "";
    };

    expect(probes.map((p) => p.n)).toEqual([1, 2, 3]);
    const seenTrue: boolean[] = [];
    for (const probe of probes) {
      const tick = outputTicks[probe.callsBefore - 1];
      expect(tick, `the console.log before probe ${probe.n} printed`).toBeDefined();
      await seekTo(page, tick ?? 0);
      const pair = REGISTERS_OF_PAIR[probe.n];
      expect(pair, `registers of probe ${probe.n}'s pair`).toBeDefined();
      const [left, right] = await Promise.all((pair ?? []).map(mapOf));
      expect(left === right, `probe ${probe.n}: ${pair?.join("/")} are ${left} and ${right}; real V8 said ${probe.value}`).toBe(probe.value === "true");
      seenTrue.push(probe.value === "true");
      // Both Maps are in the transition tree, and the table view lists them too.
      const graph = page.locator('[data-slot="hidden-classes"]');
      for (const id of new Set([left, right])) await expect(graph.locator(`g[data-map-id="${id?.replace("Map#", "")}"]`)).toHaveCount(1);
    }
    // The example must exercise both outcomes, or the check above could pass by never differing.
    expect(seenTrue).toContain(true);
    expect(seenTrue).toContain(false);

    await page.getByRole("group", { name: "View", exact: true }).getByRole("button", { name: "Table" }).click();
    const table = page.getByRole("table", { name: "Maps and the transitions between them" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("row").nth(1)).toBeVisible();
  });

  test("elements kinds: the lit node of the lattice is the kind real V8 recorded", async ({ page }) => {
    const probes = probesOf("elements-kinds-lattice-natives");
    await loadExample(page, /^elements kinds: SMI/);
    const outputTicks = await consoleOutputTicks(page);
    await openBottomTab(page, "V8 Internals");

    const lit = page.locator('[data-slot="column-c"] li[aria-current="true"] [data-kind]');
    expect(new Set(probes.map((p) => p.value)).size, "the example visits more than one kind").toBeGreaterThan(1);
    for (const probe of probes) {
      const tick = outputTicks[probe.callsBefore - 1];
      expect(tick, `the console.log before probe ${probe.n} printed`).toBeDefined();
      await seekTo(page, tick ?? 0);
      await expect(lit, `probe ${probe.n}`).toHaveText(probe.value);
    }
  });
});

test.describe("playing to the end", () => {
  type LongTaskWindow = { __longTasks: PerformanceObserver; __longest: number };

  async function playToTheEndAt8x(page: Page): Promise<number> {
    await page.evaluate(() => {
      // A browser without the entry type would report 0 for every run, which would pass for the wrong reason.
      if (!PerformanceObserver.supportedEntryTypes.includes("longtask")) throw new Error("longtask entries are not supported");
      const w = window as unknown as LongTaskWindow;
      w.__longest = 0;
      const record = (entries: PerformanceEntryList): void => {
        for (const e of entries) w.__longest = Math.max(w.__longest, e.duration);
      };
      w.__longTasks = new PerformanceObserver((list) => record(list.getEntries()));
      w.__longTasks.observe({ type: "longtask" });
      (w as unknown as { __record: typeof record }).__record = record;
    });
    await page.getByRole("radio", { name: "8×" }).click();
    await page.getByRole("button", { name: "Play" }).click();
    // The clock pauses itself at the last tick, which turns the button back to Play.
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 60_000 });
    return page.evaluate(() => {
      const w = window as unknown as LongTaskWindow & { __record: (entries: PerformanceEntryList) => void };
      w.__record(w.__longTasks.takeRecords());
      return w.__longest;
    });
  }

  for (const mode of ["3D", "2D"] as const) {
    test(`the ${mode} board plays a whole run at 8× with no long task over 50 ms`, async ({ page }) => {
      test.setTimeout(120_000);
      await openPlayground(page);
      // 130 ticks, about 16 s at 8x; "recursive factorial" has 4880, which would not reach its end in a test.
      await loadExample(page, /^await a thenable/);
      await openBottomTab(page, "Hardware");
      const toggle = page.getByRole("group", { name: "Board view", exact: true }).getByRole("button", { name: mode, exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator('[data-slot="hardware-view"] canvas')).toHaveCount(mode === "3D" ? 1 : 0);
      const longest = await playToTheEndAt8x(page);
      expect(longest, `longest long task, ms (${mode})`).toBeLessThanOrEqual(50);
    });
  }
});

test.describe("accessibility at 1280 px", () => {
  const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

  async function violations(page: Page) {
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    return results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`) }));
  }

  test.use({ viewport: { width: 1280, height: 800 } });

  test("the V8 Internals tab, mid-run, has no violations", async ({ page }) => {
    await openPlayground(page);
    await loadExample(page, /^hidden classes: same shape vs different order/);
    await openBottomTab(page, "V8 Internals");
    await seekTo(page, 20);
    await expect(page.getByRole("img", { name: /^Hidden-class transition tree/ })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test("the V8 Internals tab with the elements lattice lit has no violations", async ({ page }) => {
    await openPlayground(page);
    await loadExample(page, /^elements kinds: SMI/);
    await openBottomTab(page, "V8 Internals");
    await seekTo(page, 6);
    expect(await violations(page)).toEqual([]);
  });

  test("the Hardware tab in SVG mode has no violations", async ({ page }) => {
    await openPlayground(page);
    await loadExample(page, /^recursive factorial/);
    await openBottomTab(page, "Hardware");
    await page.getByRole("group", { name: "Board view", exact: true }).getByRole("button", { name: "2D", exact: true }).click();
    await expect(page.getByRole("group", { name: "2D hardware board" })).toBeVisible();
    await seekTo(page, 12);
    expect(await violations(page)).toEqual([]);
  });
});
