import { expect, test } from "@playwright/test";

test("presents an accessible Hello World page without todo UI", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Hello World");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Hello World", exact: true })).toHaveCount(1);
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.getByText(/todo/i)).toHaveCount(0);

  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Hello World", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("navigates to the PostgreSQL health path", async ({ page }) => {
  const response = await page.goto("/api/health");

  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toHaveText('{"status":"ok"}');
});
