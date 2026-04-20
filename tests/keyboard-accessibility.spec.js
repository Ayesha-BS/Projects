const { test, expect } = require("@playwright/test");
const { PAGES_TO_SCAN } = require("./helpers/pagesToScan");
const { waitForPageReady } = require("./helpers/pageReady");

async function collectFocusStep(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active) {
      return null;
    }

    const rect = active.getBoundingClientRect();
    const computed = window.getComputedStyle(active);
    const descriptor = `${active.tagName.toLowerCase()}#${active.id || ""}.${active.className || ""}`;

    return {
      descriptor,
      tag: active.tagName.toLowerCase(),
      hasVisibleBox: rect.width > 0 && rect.height > 0,
      hasFocusStyle:
        computed.outlineStyle !== "none" ||
        computed.outlineWidth !== "0px" ||
        computed.boxShadow !== "none",
      isBodyOrHtml: ["body", "html"].includes(active.tagName.toLowerCase())
    };
  });
}

test.describe("Keyboard Accessibility Automation", () => {
  for (const pageConfig of PAGES_TO_SCAN) {
    test(`${pageConfig.name} should support keyboard tab navigation`, async ({
      page,
      baseURL
    }) => {
      const url = new URL(pageConfig.path, baseURL).toString();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await waitForPageReady(page);

      const skipLinkCount = await page
        .locator("a[href^='#'], a")
        .filter({ hasText: /skip|zum inhalt|skip to content/i })
        .count();

      // Soft expectation: many apps intentionally omit this, so keep informative.
      test.info().annotations.push({
        type: "keyboard-skip-link",
        description: skipLinkCount > 0 ? "Skip link detected" : "Skip link not detected"
      });

      const visitedDescriptors = new Set();
      let visibleFocusHits = 0;

      for (let step = 0; step < 15; step += 1) {
        await page.keyboard.press("Tab");
        const focused = await collectFocusStep(page);
        if (!focused) {
          continue;
        }

        if (!focused.isBodyOrHtml) {
          visitedDescriptors.add(focused.descriptor);
        }
        if (focused.hasVisibleBox && focused.hasFocusStyle) {
          visibleFocusHits += 1;
        }
      }

      expect(
        visitedDescriptors.size,
        `${pageConfig.name}: Expected keyboard focus to move across multiple interactive elements`
      ).toBeGreaterThanOrEqual(3);

      expect(
        visibleFocusHits,
        `${pageConfig.name}: Expected at least one visible focus indicator while tabbing`
      ).toBeGreaterThanOrEqual(1);

      const activationTag = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return "";
        return active.tagName.toLowerCase();
      });
      if (["button", "a"].includes(activationTag)) {
        await page.keyboard.press("Enter");
      }
    });
  }
});
