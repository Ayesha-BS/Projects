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

      const metrics = await page.evaluate(() => {
        const root = document.documentElement;
        const overflowTolerancePx = 2;
        const elements = Array.from(document.querySelectorAll("body, body *"));
        const overflowing = [];

        for (const el of elements) {
          const computed = window.getComputedStyle(el);
          if (!computed) continue;
          if (computed.display === "inline") continue;
          if (computed.visibility === "hidden" || computed.display === "none") continue;

          const clientWidth = el.clientWidth || 0;
          const scrollWidth = el.scrollWidth || 0;
          if (clientWidth <= 0) continue;
          if (scrollWidth <= clientWidth + overflowTolerancePx) continue;

          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;

          overflowing.push({
            tag: (el.tagName || "").toLowerCase(),
            id: el.id || "",
            className: (el.className || "").toString().slice(0, 120),
            scrollWidth,
            clientWidth
          });
          if (overflowing.length >= 5) break;
        }

        return {
          pageScrollWidth: root.scrollWidth,
          pageClientWidth: root.clientWidth,
          overflowing
        };
      });

      // Allow tiny rendering variance across engines.
      expect(
        metrics.pageScrollWidth,
        `${pageConfig.name}: Detected horizontal overflow at narrow viewport; likely reflow issue for low-vision zoom users`
      ).toBeLessThanOrEqual(metrics.pageClientWidth + 2);

      expect(
        metrics.overflowing,
        `${pageConfig.name}: Overflowing containers detected at narrow viewport: ${JSON.stringify(
          metrics.overflowing
        )}`
      ).toEqual([]);
    });
  }
});
