const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const fs = require("fs/promises");
const path = require("path");
const { writeAccessibilityReport } = require("./helpers/accessibilityReport");
const { PAGES_TO_SCAN } = require("./helpers/pagesToScan");
const { waitForPageReady } = require("./helpers/pageReady");

const FAIL_ON_CRITICAL = String(process.env.ACCESSIBILITY_FAIL_ON_CRITICAL || "true") !== "false";
const MAX_SERIOUS = Number(process.env.ACCESSIBILITY_MAX_SERIOUS || 0);
const REPORT_IMPACTS = new Set(
  (process.env.ACCESSIBILITY_REPORT_IMPACTS || "critical,serious,moderate,minor")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

function sanitize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function captureIssueScreenshot(page, pageName, violationId, nodeIndex, selector) {
  const evidenceDir = path.resolve(process.cwd(), "reports", "accessibility", "evidence");
  await fs.mkdir(evidenceDir, { recursive: true });

  const fileName = `${Date.now()}-${sanitize(pageName)}-${sanitize(violationId)}-${nodeIndex + 1}.png`;
  const absolutePath = path.join(evidenceDir, fileName);
  const relativePath = `reports/accessibility/evidence/${fileName}`;

  if (selector) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await locator.screenshot({ path: absolutePath });
        return relativePath;
      }
    } catch (error) {
      // Fallback to full-page highlight screenshot below.
    }
  }

  if (selector) {
    try {
      await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) return;
        element.setAttribute("data-accessibility-highlight", "true");
        element.setAttribute(
          "style",
          `${element.getAttribute("style") || ""}; outline: 4px solid #d93025 !important; outline-offset: 3px !important;`
        );
      }, selector);
      await page.screenshot({ path: absolutePath, fullPage: true });
      await page.evaluate(() => {
        const element = document.querySelector("[data-accessibility-highlight='true']");
        if (!element) return;
        element.removeAttribute("data-accessibility-highlight");
        const style = element.getAttribute("style") || "";
        const cleaned = style
          .replace(/outline:\s*4px solid #d93025 !important;?/gi, "")
          .replace(/outline-offset:\s*3px !important;?/gi, "")
          .trim();
        if (cleaned) element.setAttribute("style", cleaned);
        else element.removeAttribute("style");
      });
      return relativePath;
    } catch (error) {
      // Continue to generic full-page fallback.
    }
  }

  try {
    await page.screenshot({ path: absolutePath, fullPage: true });
    return relativePath;
  } catch (error) {
    return null;
  }
}

async function enrichViolationsWithEvidence(page, pageName, blockingViolations) {
  const enriched = [];
  for (const violation of blockingViolations) {
    const nodes = [];
    const originalNodes = violation.nodes || [];
    for (let index = 0; index < originalNodes.length; index += 1) {
      const node = { ...originalNodes[index] };
      const selector = (node.target || [])[0];
      const screenshotPath = await captureIssueScreenshot(
        page,
        pageName,
        violation.id || "issue",
        index,
        selector
      );
      if (screenshotPath) {
        node.screenshotPath = screenshotPath;
      }
      nodes.push(node);
    }
    enriched.push({ ...violation, nodes });
  }
  return enriched;
}

test.describe("Generic Accessibility Smoke", () => {
  for (const pageConfig of PAGES_TO_SCAN) {
    test(`${pageConfig.name} page should have no serious or critical violations`, async ({
      page,
      baseURL
    }) => {
      const url = new URL(pageConfig.path, baseURL).toString();
      await page.goto(url, {
        waitUntil: "domcontentloaded"
      });

      await waitForPageReady(page);

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();

      const reportableViolations = accessibilityScanResults.violations.filter((violation) =>
        REPORT_IMPACTS.has((violation.impact || "").toLowerCase())
      );
      const criticalViolations = accessibilityScanResults.violations.filter(
        (violation) => (violation.impact || "") === "critical"
      );
      const seriousViolations = accessibilityScanResults.violations.filter(
        (violation) => (violation.impact || "") === "serious"
      );
      const violationsWithEvidence = await enrichViolationsWithEvidence(
        page,
        pageConfig.name,
        reportableViolations
      );

      const reportPaths = await writeAccessibilityReport({
        pageName: pageConfig.name,
        pagePath: pageConfig.path,
        url,
        scanResults: accessibilityScanResults,
        reportViolations: violationsWithEvidence
      });

      test.info().annotations.push({
        type: "accessibility-report",
        description: `Saved report: ${reportPaths.markdownPath}`
      });

      if (FAIL_ON_CRITICAL) {
        expect(
          criticalViolations.length,
          `${pageConfig.name}: Found critical accessibility issues. See reports/accessibility for details.`
        ).toBe(0);
      }

      expect(
        seriousViolations.length,
        `${pageConfig.name}: Serious accessibility violations (${seriousViolations.length}) exceeded configured maximum (${MAX_SERIOUS}).`
      ).toBeLessThanOrEqual(MAX_SERIOUS);
    });
  }
});
