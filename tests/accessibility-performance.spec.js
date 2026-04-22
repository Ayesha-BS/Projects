const { test, expect } = require("@playwright/test");
const { PAGES_TO_SCAN } = require("./helpers/pagesToScan");
const { waitForPageReady } = require("./helpers/pageReady");

const MAX_FOCUS_DELAY_MS = Number(process.env.ACCESSIBILITY_MAX_FOCUS_DELAY_MS || 250);
const KEYBOARD_TRAP_TIMEOUT_MS = Number(process.env.ACCESSIBILITY_KEYBOARD_TRAP_TIMEOUT_MS || 2000);
const MAX_DOM_GROWTH_RATIO = Number(process.env.ACCESSIBILITY_MAX_DOM_GROWTH_RATIO || 0.4);

async function getDomNodeCount(page) {
  return page.evaluate(() => document.querySelectorAll("*").length);
}

test.describe("Accessibility Performance Guardrails", () => {
  for (const pageConfig of PAGES_TO_SCAN) {
    test(`${pageConfig.name} should keep stable keyboard usability after interaction`, async ({
      page,
      baseURL
    }) => {
      const url = new URL(pageConfig.path, baseURL).toString();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await waitForPageReady(page);

      const beforeCount = await getDomNodeCount(page);
      const focusDelay = await page.evaluate(async () => {
        const start = performance.now();
        const activeBefore = document.activeElement;
        const focusables = Array.from(
          document.querySelectorAll(
            "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])"
          )
        ).filter((el) => !el.hasAttribute("disabled"));
        const candidate = focusables[0];
        if (!candidate) return 0;
        candidate.focus();
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const activeAfter = document.activeElement;
        if (!activeAfter || activeAfter === activeBefore) return 9999;
        return performance.now() - start;
      });

      const toggle = page
        .locator(
          "button[aria-expanded='false'], [role='button'][aria-expanded='false'], details > summary"
        )
        .first();
      if ((await toggle.count()) > 0) {
        await toggle.click({ timeout: 2000 }).catch(() => {});
      }
      await page.waitForTimeout(250);

      const afterCount = await getDomNodeCount(page);
      const growthRatio = beforeCount > 0 ? (afterCount - beforeCount) / beforeCount : 0;

      const trapProbe = await page.evaluate(async (timeoutMs) => {
        const start = performance.now();
        let moved = false;
        const initial = document.activeElement;
        const focusables = Array.from(
          document.querySelectorAll(
            "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])"
          )
        ).filter((el) => !el.hasAttribute("disabled"));
        if (!focusables.length) return { moved: true, elapsed: 0 };
        (focusables[0]).focus();
        while (performance.now() - start < timeoutMs) {
          const idx = focusables.indexOf(document.activeElement);
          const next = focusables[(idx + 1) % focusables.length];
          if (next) next.focus();
          await new Promise((resolve) => setTimeout(resolve, 40));
          if (document.activeElement !== initial) {
            moved = true;
            break;
          }
        }
        return { moved, elapsed: performance.now() - start };
      }, KEYBOARD_TRAP_TIMEOUT_MS);

      expect(
        focusDelay,
        `${pageConfig.name}: focus movement delay (${Math.round(focusDelay)}ms) exceeded ${MAX_FOCUS_DELAY_MS}ms`
      ).toBeLessThanOrEqual(MAX_FOCUS_DELAY_MS);
      expect(
        growthRatio,
        `${pageConfig.name}: DOM growth ratio (${growthRatio.toFixed(2)}) exceeded ${MAX_DOM_GROWTH_RATIO}`
      ).toBeLessThanOrEqual(MAX_DOM_GROWTH_RATIO);
      expect(
        trapProbe.moved,
        `${pageConfig.name}: potential keyboard trap detected (probe elapsed ${Math.round(
          trapProbe.elapsed
        )}ms)`
      ).toBeTruthy();
    });
  }
});
