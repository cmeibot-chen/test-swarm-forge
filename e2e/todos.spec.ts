import { expect, test } from "@playwright/test";

test("adds a todo and lists it", async ({ page }) => {
  const text = process.env.E2E_TODO ?? "Buy milk (browser)";
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Todo list" })).toBeVisible();
  await page.getByLabel("New todo").fill(text);
  await page.getByRole("button", { name: "Add todo" }).click();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});
