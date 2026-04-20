const { test, expect } = require("@playwright/test");
const { PAGES_TO_SCAN } = require("./helpers/pagesToScan");
const { waitForPageReady } = require("./helpers/pageReady");

test.describe("Low Vision Reflow Automation", () => {
  for (const pageConfig of PAGES_TO_SCAN) {
    test(`${pageConfig.name} should not require horizontal scrolling at narrow viewport`, async ({
      page,
      baseURL
    }) => {
      await page.setViewportSize({ width: 320, height: 900 });

      const url = new URL(pageConfig.path, baseURL).toString();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await waitForPageReady(page);

      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));

      // Allow tiny rendering variance across engines.
      expect(
        metrics.scrollWidth,
        `${pageConfig.name}: Detected horizontal overflow at narrow viewport; likely reflow issue for low-vision zoom users`
      ).toBeLessThanOrEqual(metrics.clientWidth + 2);
    });
  }
});
