import { expect, test } from "@playwright/test";

test("playground renders its placeholder", async ({ page }) => {
  await page.goto("/playground");
  await expect(page.getByRole("heading", { level: 1, name: "Playground" })).toBeVisible();
  await expect(page).toHaveTitle("Playground · Silicon Loop");
});

test("landing links to the playground", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open the playground" }).click();
  await expect(page).toHaveURL(/\/playground$/);
});
