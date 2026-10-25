// The helper `test` marks the coach marks as seen: their overlay can otherwise cover the editor these specs click.
import { expect, test } from "./helpers/playground";

test("playground renders the IDE: editor, code panes and run panel", async ({ page }) => {
  await page.goto("/playground");
  await expect(page.getByRole("heading", { level: 1, name: "Playground" })).toBeAttached();
  await expect(page).toHaveTitle("Playground · Silicon Loop");

  await expect(page.getByRole("region", { name: "Editor" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Compiled views" }).getByRole("tab")).toHaveText(["AST", "Bytecode", "Machine Code"]);
  await expect(page.getByRole("tablist", { name: "Run views" }).getByRole("tab")).toHaveText(["Event Loop", "V8 Internals", "Hardware"]);
  await expect(page.getByRole("region", { name: "Playback" })).toBeVisible();
  // The segmented control is for narrow screens only.
  await expect(page.getByRole("radiogroup", { name: "Playground section" })).toBeHidden();
});

test("the opening program is the nextTick vs Promise example, verified against Node", async ({ page }) => {
  await page.goto("/playground");
  await expect(page.getByText("Matches Node v24.19.0 (V8 13.6.233.17-node.51)")).toBeVisible();
  await expect(page.getByTestId("status")).toHaveText("Ready", { timeout: 30_000 });
});

test("editing the source drops the verified badge", async ({ page }) => {
  await page.goto("/playground");
  const editor = page.getByRole("textbox", { name: "Source code" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("// edited");
  await expect(page.getByText("Simulated by spec model")).toBeVisible();
  await expect(page.getByText(/Matches Node/)).toHaveCount(0);
});

test("typing over a selection of highlighted code raises no CSP violation", async ({ page }) => {
  // Chromium would copy the replaced text's color onto the new text as an inline style, which the CSP blocks.
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto("/playground");
  const editor = page.getByRole("textbox", { name: "Source code" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("let typed = 1;");
  await expect(editor).toContainText("let typed = 1;");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("let inserted = 2;");
  await expect(editor).toContainText("let inserted = 2;");
  expect(violations).toEqual([]);
});

test("choosing an example over edited code asks first", async ({ page }) => {
  await page.goto("/playground");
  const editor = page.getByRole("textbox", { name: "Source code" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("let mine = 1;");
  await page.getByRole("button", { name: "Examples" }).click();
  await page.getByRole("menuitem", { name: /Promise vs setTimeout/ }).click();
  const dialog = page.getByRole("alertdialog", { name: "Replace your code with 'Promise vs setTimeout'?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toContainText("let mine = 1;");

  await page.getByRole("button", { name: "Examples" }).click();
  await page.getByRole("menuitem", { name: /Promise vs setTimeout/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Replace" }).click();
  await expect(editor).toContainText("script start");
  await expect(page.getByText(/Matches Node/)).toBeVisible();
});

test("an empty editor lists the examples", async ({ page }) => {
  await page.goto("/playground");
  const editor = page.getByRole("textbox", { name: "Source code" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  const list = page.getByRole("region", { name: "Start with an example" });
  await expect(list).toBeVisible();
  await list.getByRole("button", { name: /async\/await ordering/ }).click();
  await expect(list).toBeHidden();
  await expect(editor).toContainText("async");
});

test("a problems row moves the cursor into the editor", async ({ page }) => {
  await page.goto("/playground");
  const editor = page.getByRole("textbox", { name: "Source code" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  // `with` is outside the supported subset, so the pipeline refuses it with a diagnostic.
  await page.keyboard.insertText("with (Math) { console.log(PI); }");
  const row = page.getByRole("list", { name: "Problems" }).getByRole("button").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Examples" }).focus();
  await row.click();
  await expect(editor).toBeFocused();
});

test("landing links to the playground", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open the playground" }).click();
  await expect(page).toHaveURL(/\/playground$/);
});
