import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const FIXTURES = join(process.cwd(), "tests", "conformance", "fixtures");
const source = readFileSync(join(FIXTURES, "nexttick-vs-promise.cjs"), "utf8");
const recorded = JSON.parse(readFileSync(join(FIXTURES, "nexttick-vs-promise.expected.json"), "utf8")) as {
  outcomes: { stdout: string }[];
};
const stdout = recorded.outcomes[0]?.stdout ?? "";

test("the worker runs a program and a newer edit supersedes an older one", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));

  await page.goto("/playground");
  const editor = page.getByRole("textbox", { name: "Source code" });
  const status = page.getByTestId("status");
  const output = page.getByTestId("console");
  // A new run opens on tick 0 with no output yet; the console shows what the program has printed so far, so
  // the output is read at the last tick. The click repeats until it lands on the new run's timeline: an edit
  // can still be in its debounce, and a click then seeks the old timeline, which the new run replaces at tick 0.
  const expectFinalOutput = async (text: string): Promise<void> => {
    await expect(async () => {
      await page.getByRole("button", { name: "Last tick" }).click({ timeout: 2_000 });
      await expect(output).toHaveText(text, { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
  };
  // The editor is CodeMirror: select all, then insert text as one input event.
  const setSource = async (text: string): Promise<void> => {
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(text);
  };

  // Type something else first, so the recorded program below arrives through an edit, not as the page's own default.
  await setSource('console.log("warm up");');
  await expectFinalOutput("warm up\n");
  await setSource(source);
  await expect(status).toHaveText("Ready", { timeout: 30_000 });
  await expectFinalOutput(stdout);

  // An edit after the first program was dispatched: only the second program's output may survive.
  // The engine bounds a run to well under a second, so whether the worker is still busy when the
  // second edit's debounce fires is a race; the terminate path itself is covered deterministically in
  // PipelineClient.test.ts. This checks the end state either way.
  await setSource('for (let i = 0; i < 1000000; i++) {}\nconsole.log("first");');
  // rAF polling, so the short in-flight window is not missed between two 100 ms polls.
  await page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent !== "Ready", null, { polling: "raf", timeout: 10_000 });
  await setSource('console.log("second");');
  await expectFinalOutput("second\n");
  await expect(status).toHaveText("Ready");

  expect(problems).toEqual([]);
});
