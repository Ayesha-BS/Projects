const { waitForPageReady } = require("./pageReady");

const DEFAULT_MAX_ACTIONS = Number(process.env.ACCESSIBILITY_DEEP_CRAWL_MAX_ACTIONS || 20);
const DEFAULT_MAX_LOAD_MORE = Number(process.env.ACCESSIBILITY_DEEP_CRAWL_MAX_LOAD_MORE || 3);
const BLOCKED_ACTION_TEXT =
  /delete|remove|submit|logout|sign out|purchase|pay|buy|checkout|confirm/i;

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRoleName(candidate) {
  const role = String(candidate.roleName || "").toLowerCase();
  if (["button", "link", "tab", "menuitem"].includes(role)) {
    return role;
  }
  return "";
}

function buildNamePattern(candidate) {
  const raw = String(candidate.name || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const shortened = raw.slice(0, 60);
  if (shortened.length < 2) return null;
  return new RegExp(escapeRegExp(shortened), "i");
}

async function resolveCandidateLocator(page, candidate) {
  const locators = [];
  const normalizedRole = normalizeRoleName(candidate);
  const namePattern = buildNamePattern(candidate);

  if (normalizedRole && namePattern) {
    locators.push(page.getByRole(normalizedRole, { name: namePattern }).first());
  }
  if (normalizedRole) {
    locators.push(page.getByRole(normalizedRole).first());
  }
  if (candidate.name) {
    locators.push(
      page
        .locator("button, a, summary, [role='button'], [role='tab'], [aria-controls], [aria-haspopup='true']")
        .filter({ hasText: candidate.name })
        .first()
    );
  }

  // Keep XPath as final fallback to avoid losing coverage on dynamic UIs.
  if (candidate.xpath) {
    locators.push(page.locator(`xpath=${candidate.xpath}`).first());
  }

  for (const locator of locators) {
    try {
      if ((await locator.count()) > 0) {
        return locator;
      }
    } catch (error) {
      // Try next locator strategy.
    }
  }
  return null;
}

function shouldUseDeepCrawl() {
  return String(process.env.ACCESSIBILITY_DEEP_CRAWL || "true") !== "false";
}

async function discoverCandidates(page) {
  return page.evaluate(() => {
    function getXPath(element) {
      if (!element || element.nodeType !== 1) return "";
      if (element.id) return `//*[@id="${element.id}"]`;
      const parts = [];
      let el = element;
      while (el && el.nodeType === 1) {
        let index = 1;
        let sibling = el.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === el.tagName) index += 1;
          sibling = sibling.previousElementSibling;
        }
        parts.unshift(`${el.tagName.toLowerCase()}[${index}]`);
        el = el.parentElement;
      }
      return `/${parts.join("/")}`;
    }

    const selector = [
      "button[aria-expanded='false']",
      "[role='button'][aria-expanded='false']",
      "[data-bs-toggle='dropdown']",
      "[aria-haspopup='true']",
      "[aria-controls]",
      ".accordion-button",
      "details > summary",
      "[role='tab']",
      ".tab",
      "[data-bs-toggle='tab']",
      "[data-cookie-accept], [id*='cookie'] button, [class*='cookie'] button",
      "button, a"
    ].join(",");

    const elements = Array.from(document.querySelectorAll(selector));
    const unique = new Set();
    const candidates = [];

    for (const element of elements) {
      const text = (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120);
      const ariaLabel = (element.getAttribute("aria-label") || "").trim().slice(0, 120);
      const title = (element.getAttribute("title") || "").trim().slice(0, 120);
      const xpath = getXPath(element);
      if (!xpath || unique.has(xpath)) continue;
      unique.add(xpath);
      const tagName = element.tagName.toLowerCase();
      const explicitRole = (element.getAttribute("role") || "").toLowerCase();
      const roleName =
        explicitRole ||
        (tagName === "button" ? "button" : "") ||
        (tagName === "a" && element.hasAttribute("href") ? "link" : "") ||
        (tagName === "summary" ? "button" : "");
      const role =
        roleName || element.getAttribute("data-bs-toggle") || element.tagName.toLowerCase();
      const name = ariaLabel || title || text;
      candidates.push({ xpath, text, role, roleName, name });
    }

    return candidates;
  });
}

function isLoadMoreCandidate(candidate) {
  return /load more|show more|mehr|weiter|view more/i.test(candidate.text || "");
}

function isCookieBannerCandidate(candidate) {
  return /cookie|consent|accept|zustimmen|einverstanden/i.test(candidate.text || "");
}

async function performDeepInteractionCrawl(page) {
  const actions = [];
  if (!shouldUseDeepCrawl()) {
    return actions;
  }

  const startUrl = page.url();
  const candidates = await discoverCandidates(page);
  const maxActions = Math.max(0, DEFAULT_MAX_ACTIONS);
  let loadMoreClicks = 0;

  for (let index = 0; index < Math.min(candidates.length, maxActions); index += 1) {
    const candidate = candidates[index];
    if (!candidate || BLOCKED_ACTION_TEXT.test(candidate.text || "")) {
      continue;
    }

    if (isLoadMoreCandidate(candidate) && loadMoreClicks >= DEFAULT_MAX_LOAD_MORE) {
      continue;
    }

    const locator = await resolveCandidateLocator(page, candidate);
    try {
      if (!locator || (await locator.count()) === 0) continue;
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: 2000 });
      const actionType = isCookieBannerCandidate(candidate)
        ? "cookie"
        : isLoadMoreCandidate(candidate)
          ? "load-more"
          : candidate.roleName || candidate.role || "generic";
      actions.push(`clicked(${actionType}): ${candidate.name || candidate.text || candidate.xpath}`);
      if (isLoadMoreCandidate(candidate)) loadMoreClicks += 1;
      await page.waitForTimeout(300);
    } catch (error) {
      actions.push(`skipped: ${candidate.name || candidate.text || candidate.xpath}`);
    }
  }

  if (page.url() !== startUrl) {
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    actions.push("restored original URL after interaction crawl");
  }

  return actions;
}

module.exports = { shouldUseDeepCrawl, performDeepInteractionCrawl };
