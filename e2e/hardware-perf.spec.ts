import { expect, loadExample, openBottomTab, test } from "./helpers/playground";

// Needs a real GPU and a visible window: run `PERF=1 npm run e2e -- hardware-perf --headed`. A software renderer (SwiftShader) makes the number meaningless.
test.skip(process.env.PERF !== "1", "set PERF=1 (and --headed on a machine with a GPU) to measure the 3D board");

const MIN_FPS = 55;
const PLAY_MS = 10_000;

type FpsWindow = { __slHwFps?: () => number; __secondFps: number[] };

test("the 3D board holds 55 fps while playing at 2x", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  // ?perf=1 mounts the rAF fps sampler (PerfOverlay); it answers window.__slHwFps() with the average since it mounted.
  await page.goto("/playground?perf=1");
  await expect(page.getByTestId("status")).toHaveText("Ready", { timeout: 30_000 });
  await loadExample(page, /^recursive factorial/);
  await openBottomTab(page, "Hardware");
  await expect(page.getByRole("group", { name: "Board view", exact: true }).getByRole("button", { name: "3D", exact: true })).toHaveAttribute("aria-pressed", "true");
  const canvas = page.locator('[data-slot="hardware-view"] canvas');
  await expect(canvas).toBeVisible();

  const renderer = await canvas.evaluate((el) => {
    const gl = (el as HTMLCanvasElement).getContext("webgl2") ?? (el as HTMLCanvasElement).getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });

  // A second, independent counter over the playing window only, for the minimum: frames per whole second of display time.
  await page.evaluate(() => {
    const w = window as unknown as FpsWindow;
    w.__secondFps = [];
    let frames = 0;
    let windowStart = performance.now();
    const tick = (now: number): void => {
      frames += 1;
      if (now - windowStart >= 1000) {
        w.__secondFps.push((frames * 1000) / (now - windowStart));
        frames = 0;
        windowStart = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.getByRole("radio", { name: "2×" }).click();
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.waitForTimeout(PLAY_MS);
  await expect(page.getByRole("button", { name: "Pause" }), "still playing after 10 s").toBeVisible();

  const { average, perSecond } = await page.evaluate(() => {
    const w = window as unknown as FpsWindow;
    return { average: w.__slHwFps?.() ?? Number.NaN, perSecond: w.__secondFps };
  });
  const min = Math.min(...perSecond);
  const summary = `renderer=${renderer}; average=${average.toFixed(1)} fps (sampler since mount); playing window: min=${min.toFixed(1)} fps over ${perSecond.length} s, mean=${(perSecond.reduce((a, b) => a + b, 0) / perSecond.length).toFixed(1)} fps`;
  testInfo.annotations.push({ type: "fps", description: summary });
  console.log(`PERF ${summary}`);

  expect(average, summary).toBeGreaterThanOrEqual(MIN_FPS);
});
