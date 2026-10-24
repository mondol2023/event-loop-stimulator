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
  const editor = page.getByLabel("Source");
  const status = page.getByTestId("status");
  const output = page.getByTestId("console");

  await editor.fill(source);
  await expect(status).toHaveText("ready", { timeout: 30_000 });
  await expect(output).toHaveText(stdout);

  // Two edits back to back: only the second program's output may survive.
  await editor.fill('console.log("first");');
  await editor.fill('console.log("second");');
  await expect(output).toHaveText("second\n", { timeout: 30_000 });
  await expect(status).toHaveText("ready");

  expect(problems).toEqual([]);
});
