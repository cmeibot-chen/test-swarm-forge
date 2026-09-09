import { expect, test } from "@playwright/test";

test("presents an accessible Hello World page without todo UI", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Hello World");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Hello World", exact: true })).toHaveCount(1);
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.getByText(/todo/i)).toHaveCount(0);

  for (const { width, zoom } of [{ width: 1280, zoom: 1 }, { width: 375, zoom: 1 }, { width: 375, zoom: 2 }]) {
    await page.setViewportSize({ width, height: 800 });
    await page.reload();
    if (zoom !== 1) {
      await page.evaluate((value) => { document.documentElement.style.zoom = String(value); }, zoom);
    }
    await expect(page.getByRole("heading", { level: 1, name: "Hello World", exact: true })).toBeVisible();
    const layout = await page.evaluate(() => {
      const heading = document.querySelector("h1");
      const rect = heading?.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        headingText: heading?.textContent,
        headingRect: rect ? { width: rect.width, height: rect.height } : null,
      };
    });
    expect(layout.headingText).toBe("Hello World");
    expect(layout.headingRect?.width ?? 0).toBeGreaterThan(0);
    expect(layout.headingRect?.height ?? 0).toBeGreaterThan(0);
    if (zoom === 1) expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);

    const contrast = await page.evaluate(() => {
      const heading = document.querySelector("h1");
      if (!heading) return 0;
      const parseColor = (value: string) => {
        const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return match ? match.slice(1, 4).map(Number) : null;
      };
      const luminance = (value: number[]) => value
        .map((channel) => channel / 255)
        .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const foreground = parseColor(getComputedStyle(heading).color);
      const background = parseColor(getComputedStyle(document.documentElement).backgroundColor);
      if (!foreground || !background) return 0;
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
});

test("navigates to the PostgreSQL health path", async ({ page }) => {
  const response = await page.goto("/api/health");

  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toHaveText('{"status":"ok"}');
});
