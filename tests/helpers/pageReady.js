async function waitForPageReady(page) {
  const selectors = (process.env.ACCESSIBILITY_READY_SELECTORS || "main,header,nav")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const timeout = Number(process.env.ACCESSIBILITY_READY_TIMEOUT_MS || 12000);
  const perSelectorTimeout = Math.max(1000, Math.floor(timeout / Math.max(1, selectors.length)));

  await page.waitForLoadState("domcontentloaded");

  for (const selector of selectors) {
    try {
      await page.locator(selector).first().waitFor({
        state: "visible",
        timeout: perSelectorTimeout
      });
      return;
    } catch (error) {
      // Try next selector.
    }
  }

  // Fallback when no selector becomes visible.
  await page.waitForTimeout(1500);
}

module.exports = { waitForPageReady };
