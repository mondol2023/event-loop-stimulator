import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  consoleOutput,
  expect,
  focusPage,
  installLayoutShiftObserver,
  loadExample,
  openPlayground,
  readLayoutShift,
  status,
  test,
  tickReadout,
  waitForRunAfterEdit,
} from "./helpers/playground";

const FIXTURES = join(process.cwd(), "tests", "conformance", "fixtures");
const recorded = JSON.parse(readFileSync(join(FIXTURES, "nexttick-vs-promise.expected.json"), "utf8")) as { outcomes: { stdout: string }[] };
const STDOUT = recorded.outcomes[0]?.stdout ?? "";
const NEXTTICK_TICKS = 40;

test("stepping through nextTick vs Promise shows the queues and prints the recorded output in order", async ({ page }) => {
  expect(STDOUT).toContain("sync 1\n");
  await openPlayground(page);
  await loadExample(page, /^nextTick vs Promise/);
  await focusPage(page);
  await expect(tickReadout(page, 1, NEXTTICK_TICKS)).toBeVisible();

  // Shift+Right jumps to the next job start; from tick 1 that is tick 8, with two nextTick and two microtask chips.
  await page.keyboard.press("Shift+ArrowRight");
  await expect(tickReadout(page, 8, NEXTTICK_TICKS)).toBeVisible();
  await expect(page.getByTestId("region-nexttick").getByTestId("task-label")).toHaveCount(2);
  await expect(page.getByTestId("region-microtask").getByTestId("task-label")).toHaveCount(2);

  // Back to the start, then one step at a time to the end.
  await page.keyboard.press("Home");
  await expect(tickReadout(page, 1, NEXTTICK_TICKS)).toBeVisible();
  const snapshots: string[] = [(await consoleOutput(page).textContent()) ?? ""];
  for (let tick = 2; tick <= NEXTTICK_TICKS; tick++) {
    await page.keyboard.press("ArrowRight");
    await expect(tickReadout(page, tick, NEXTTICK_TICKS)).toBeVisible();
    snapshots.push((await consoleOutput(page).textContent()) ?? "");
  }

  const lines = STDOUT.split("\n").slice(0, -1);
  let printed = 0;
  for (const [i, snapshot] of snapshots.entries()) {
    expect(STDOUT.startsWith(snapshot), `tick ${i + 1}: ${JSON.stringify(snapshot)} is a prefix of the recorded stdout`).toBe(true);
    // Whole lines only, and each in the order it was recorded.
    const shown = snapshot === "" ? [] : snapshot.split("\n").slice(0, -1);
    expect(shown).toEqual(lines.slice(0, shown.length));
    expect(shown.length).toBeGreaterThanOrEqual(printed);
    printed = shown.length;
  }
  expect(snapshots.at(-1)).toBe(STDOUT);
});

test("hovering a line in any pane outlines the matching source line", async ({ page }) => {
  await openPlayground(page);
  await loadExample(page, /^nextTick vs Promise/);
  await focusPage(page);

  const editor = page.getByRole("region", { name: "Editor" });
  const sourceCurrent = editor.locator('.cm-line[data-sl-highlight~="current"]');
  const sourceHovered = editor.locator('.cm-line[data-sl-highlight~="hovered"]');

  // The first tick stops on console.log("sync 1"): that source line is current, and so is the line it maps to in each pane.
  await expect(sourceCurrent.first()).toContainText('console.log("sync 1")');

  const panes = [
    { tab: "AST", region: "AST" },
    { tab: "Bytecode", region: "Bytecode" },
    { tab: "Machine Code", region: "Machine code" },
  ];
  for (const { tab, region } of panes) {
    await page.getByRole("tab", { name: tab }).click();
    const pane = page.getByRole("region", { name: region, exact: true });
    const paneCurrent = pane.locator('.cm-line[data-sl-highlight~="current"]');
    await expect(paneCurrent.first(), `${tab} marks the line current`).toBeVisible();

    // Hover the pane's line for that statement: the source shows the outline on the same statement.
    await paneCurrent.first().hover();
    await expect(pane.locator('.cm-line[data-sl-highlight~="hovered"]').first(), `${tab} outlines its own line`).toBeVisible();
    await expect(sourceHovered.first(), `${tab} line outlines source`).toContainText("sync 1");
  }

  // The other way round: hovering the source line outlines at least one line in the visible pane, here Machine Code,
  // and (after switching) in the AST and Bytecode panes too.
  for (const { tab, region } of panes) {
    await page.getByRole("tab", { name: tab }).click();
    const pane = page.getByRole("region", { name: region, exact: true });
    await editor.locator(".cm-line", { hasText: 'console.log("sync 1")' }).hover();
    await expect(sourceHovered.first()).toContainText("sync 1");
    await expect(pane.locator('.cm-line[data-sl-highlight~="hovered"]').first(), `${tab} outlines a line for the hovered source`).toBeVisible();
  }
});

test("the nondeterministic example says so on its badge, in the scrubber marker's tooltip and on the chips", async ({ page }) => {
  await openPlayground(page);
  await loadExample(page, /setTimeout 0 vs setImmediate/);

  const phrase = "Order not guaranteed in real Node";
  await expect(page.getByText(phrase, { exact: true })).toBeVisible();
  await expect(page.getByText(/^Matches Node/)).toBeVisible();

  const length = Number(((await page.getByText(/^Tick \d+ \/ \d+$/).textContent()) ?? "").split("/")[1]);
  await page.getByRole("radio", { name: "8×" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(tickReadout(page, length, length)).toBeVisible({ timeout: 30_000 });

  // The scrubber has a warning marker, and hovering it shows the warning's words in its tooltip.
  const marker = page.locator('[data-marker="warning"]').first();
  await expect(marker).toBeAttached();
  await marker.hover();
  await expect(page.getByRole("tooltip").filter({ hasText: phrase }).first()).toBeVisible();

  // Stepping from the start, the warning reaches the run panel: a pending timer or immediate chip is flagged.
  await focusPage(page);
  await page.keyboard.press("Home");
  const flagged = page.getByTestId("warning-chip");
  let tick = 1;
  while ((await flagged.count()) === 0 && tick < length) {
    await page.keyboard.press("ArrowRight");
    tick += 1;
    await expect(tickReadout(page, tick, length)).toBeVisible();
  }
  await expect(flagged.first(), `a chip is flagged by tick ${tick}`).toBeVisible();
  await expect(flagged.first()).toContainText("Order not guaranteed");
});

test("playing at 8x to the end shifts nothing: cumulative layout shift stays under 0.01", async ({ page }) => {
  await openPlayground(page);
  await loadExample(page, /^nextTick vs Promise/);
  await installLayoutShiftObserver(page);

  await page.getByRole("radio", { name: "8×" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(tickReadout(page, NEXTTICK_TICKS, NEXTTICK_TICKS)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  // A frame for any late shift entry to be delivered.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const shift = await readLayoutShift(page);
  test.info().annotations.push({ type: "cumulative layout shift", description: shift.toFixed(5) });
  expect(shift).toBeLessThan(0.01);
});

test("opening and using every overlay and view raises no CSP message", async ({ page }) => {
  await openPlayground(page);
  await loadExample(page, /^nextTick vs Promise/);

  // A tooltip: hover a transport button.
  await page.getByRole("button", { name: "Step forward" }).hover();
  await expect(page.getByRole("tooltip").first()).toBeVisible();

  // Switching the language to TypeScript gives the palette something to strip.
  await page.getByRole("radio", { name: "TS" }).click();
  await waitForRunAfterEdit(page);

  // The palette, then the stripped JS dialog from it.
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.getByRole("option", { name: "Show stripped JS" }).click();
  const stripped = page.getByRole("dialog", { name: "Stripped JavaScript" });
  await expect(stripped).toBeVisible();
  await expect(stripped.getByRole("textbox", { name: "Stripped JavaScript" })).toContainText("sync 1");
  await page.keyboard.press("Escape");
  await expect(stripped).toBeHidden();

  // The theme, both ways, from the palette.
  await page.keyboard.press("ControlOrMeta+K");
  await page.getByRole("option", { name: "Theme: Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.keyboard.press("ControlOrMeta+K");
  await page.getByRole("option", { name: "Theme: Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  // Machine code in Intel syntax and in binary.
  await page.getByRole("tab", { name: "Machine Code" }).click();
  await page.getByRole("radio", { name: "Intel" }).click();
  await expect(page.getByRole("region", { name: "Machine code" }).getByRole("textbox", { name: "Machine code" })).toBeVisible();
  await page.getByRole("radio", { name: "binary" }).click();
  await expect(page.getByRole("region", { name: "Machine code" }).locator(".cm-line").first()).toContainText(/[01]{8}/);

  // The 2D view during playback.
  await page.getByRole("tab", { name: "Event Loop" }).click();
  await page.getByRole("radio", { name: "4×" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(tickReadout(page, NEXTTICK_TICKS, NEXTTICK_TICKS)).toBeVisible({ timeout: 30_000 });
  await expect(status(page)).toHaveText("Ready");
});

test("with reduced motion, no animation runs while stepping", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openPlayground(page);
  await loadExample(page, /^nextTick vs Promise/);
  await focusPage(page);

  for (let tick = 2; tick <= 11; tick++) {
    await page.keyboard.press("ArrowRight");
    await expect(tickReadout(page, tick, NEXTTICK_TICKS)).toBeVisible();
    // Two frames for the step to render and start whatever it animates, then one sample. No polling: a poll would
    // pass as soon as a finite animation (a 150 ms fade) ended, whether or not reduced motion had stopped it.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const running = await page.evaluate(() => document.getAnimations().map((a) => `${a.constructor.name} ${a.playState} ${(a.effect as KeyframeEffect | null)?.target?.tagName ?? "?"}`));
    expect(running, `running animations at tick ${tick}`).toEqual([]);
  }
});
