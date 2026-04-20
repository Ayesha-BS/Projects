const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const HISTORY_DIR = path.resolve(process.cwd(), "reports", "accessibility-history");

function remediationHint(violation) {
  const id = (violation.id || "").toLowerCase();
  const description = `${violation.help || ""} ${violation.description || ""}`.toLowerCase();

  if (id.includes("color") || description.includes("contrast")) {
    return "Increase text and UI contrast to WCAG AA (at least 4.5:1 for normal text).";
  }
  if (id.includes("image-alt") || id.includes("image") || id.includes("alt")) {
    return "Add meaningful alt text for informative images; use empty alt for decorative images.";
  }
  if (id.includes("label") || description.includes("form")) {
    return "Add explicit labels using label, aria-label, or aria-labelledby for all form controls.";
  }
  if (id.includes("html-has-lang") || description.includes("lang attribute")) {
    return "Set the page language on the html element, for example <html lang=\"de\">.";
  }
  if (id.includes("listitem")) {
    return "Wrap li elements inside proper ul or ol containers.";
  }
  if (id.includes("nested-interactive")) {
    return "Do not nest interactive controls. Use either button or link, not both together.";
  }
  if (id.includes("aria")) {
    return "Use only valid ARIA attributes for the assigned role and ensure semantic HTML first.";
  }
  return "Use semantic HTML, fix the failing node(s), and verify against the linked accessibility rule.";
}

function fixSnippet(ruleId) {
  const snippets = {
    "image-alt": "<img src=\"hero.jpg\" alt=\"Descriptive content\" />",
    "html-has-lang": "<html lang=\"de\">",
    "nested-interactive": "<a class=\"button-link\" href=\"/about\">Learn more</a>",
    "color-contrast":
      "/* Increase contrast */ .menu-link { color:#595959; background:#ffffff; }",
    listitem: "<ul><li>Datenschutz</li><li>Impressum</li></ul>",
    "aria-allowed-attr": "<button aria-expanded=\"false\" aria-controls=\"menu-1\">Menu</button>",
    "link-name": "<a href=\"/overview\" aria-label=\"Overview\">Overview</a>"
  };
  return snippets[ruleId] || "<!-- Apply semantic HTML and accessible naming for this component -->";
}

function extractWcagCriteria(tags = []) {
  const criteria = [];
  for (const tag of tags) {
    const match = /^wcag(\d{3,4})$/i.exec(tag);
    if (!match) continue;
    const digits = match[1];
    const parts = digits.split("");
    if (parts.length === 3) {
      criteria.push(`${parts[0]}.${parts[1]}.${parts[2]}`);
    } else if (parts.length === 4) {
      criteria.push(`${parts[0]}.${parts[1]}.${parts[2]}${parts[3]}`);
    }
  }
  return Array.from(new Set(criteria));
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeScreenshotPath(screenshotPath) {
  if (!screenshotPath || screenshotPath === "N/A") return null;
  const marker = "reports/accessibility/evidence/";
  if (screenshotPath.startsWith(marker)) return screenshotPath.slice(marker.length);
  return path.basename(screenshotPath);
}

function severityScore(severity) {
  if (severity === "critical") return 2;
  if (severity === "serious") return 1;
  return 0;
}

function severityLabel(severity) {
  if (severity === "critical") return "High";
  if (severity === "serious") return "Medium";
  return "Low";
}

async function generatePdfFromHtml(htmlPath, pdfPath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" }
    });
  } finally {
    await browser.close();
  }
}

async function removeDirectoryContents(targetDir) {
  try {
    const names = await fs.readdir(targetDir);
    await Promise.all(
      names.map((name) => fs.rm(path.join(targetDir, name), { recursive: true, force: true }))
    );
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
}

async function getLatestReports() {
  const reportsDir = path.resolve(process.cwd(), "reports", "accessibility");
  const fileNames = (await fs.readdir(reportsDir)).filter((name) => name.endsWith(".json"));
  const latestByUrl = new Map();

  for (const fileName of fileNames) {
    const absolute = path.join(reportsDir, fileName);
    const report = JSON.parse(await fs.readFile(absolute, "utf8"));
    const key = report.url || report.pagePath || fileName;
    const generatedAtMs = new Date(report.generatedAt || 0).getTime();
    const existing = latestByUrl.get(key);
    if (!existing || generatedAtMs > existing.generatedAtMs) {
      latestByUrl.set(key, { generatedAtMs, report });
    }
  }

  return Array.from(latestByUrl.values()).map((item) => item.report);
}

function buildDedupedIssues(reports) {
  const deduped = new Map();
  for (const report of reports) {
    for (const violation of report.reportViolations || report.blockingViolations || []) {
      for (const node of violation.nodes || [{}]) {
        const selector = (node.target || []).join(" | ") || "N/A";
        const signature = `${report.url}|${violation.id}|${selector}`;
        const existing = deduped.get(signature);
        if (!existing) {
          deduped.set(signature, {
            signature,
            severity: violation.impact || "unknown",
            severityLabel: severityLabel(violation.impact || "unknown"),
            url: report.url || report.pagePath || "unknown",
            issueRule: violation.id || "unknown-rule",
            issueSummary: node.failureSummary || violation.help || "",
            selector,
            possibleFix: remediationHint(violation),
            screenshotFileName: normalizeScreenshotPath(node.screenshotPath || ""),
            tags: violation.tags || [],
            wcagCriteria: extractWcagCriteria(violation.tags || []),
            frequency: 1
          });
        } else {
          existing.frequency += 1;
          if (!existing.screenshotFileName) {
            existing.screenshotFileName = normalizeScreenshotPath(node.screenshotPath || "");
          }
          if (severityScore(violation.impact || "unknown") > severityScore(existing.severity)) {
            existing.severity = violation.impact || "unknown";
            existing.severityLabel = severityLabel(violation.impact || "unknown");
          }
          const mergedTags = new Set([...(existing.tags || []), ...(violation.tags || [])]);
          existing.tags = Array.from(mergedTags);
          const mergedCriteria = new Set([
            ...(existing.wcagCriteria || []),
            ...extractWcagCriteria(violation.tags || [])
          ]);
          existing.wcagCriteria = Array.from(mergedCriteria);
        }
      }
    }
  }

  return Array.from(deduped.values()).sort((a, b) => {
    const scoreDiff = severityScore(b.severity) - severityScore(a.severity);
    if (scoreDiff !== 0) return scoreDiff;
    return b.frequency - a.frequency;
  });
}

function computeRegression(currentIssues, previousSignatures) {
  const currentSet = new Set(currentIssues.map((issue) => issue.signature));
  const previousSet = new Set(previousSignatures);
  let added = 0;
  let existing = 0;
  for (const sig of currentSet) {
    if (previousSet.has(sig)) existing += 1;
    else added += 1;
  }
  let fixed = 0;
  for (const sig of previousSet) {
    if (!currentSet.has(sig)) fixed += 1;
  }
  return { added, existing, fixed };
}

async function readPreviousBaseline() {
  try {
    const baselinePath = path.join(HISTORY_DIR, "latest-issues.json");
    const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
    return Array.isArray(baseline.signatures) ? baseline.signatures : [];
  } catch (error) {
    return [];
  }
}

async function writeBaseline(signatures) {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const baselinePath = path.join(HISTORY_DIR, "latest-issues.json");
  await fs.writeFile(
    baselinePath,
    JSON.stringify({ updatedAt: new Date().toISOString(), signatures }, null, 2),
    "utf8"
  );
}

async function main() {
  const reports = await getLatestReports();
  if (!reports.length) {
    throw new Error("No per-page reports found in reports/accessibility. Run accessibility tests first.");
  }

  const dedupedIssues = buildDedupedIssues(reports);
  const prevSignatures = await readPreviousBaseline();
  const regression = computeRegression(dedupedIssues, prevSignatures);
  await writeBaseline(dedupedIssues.map((issue) => issue.signature));

  const failOnCritical = String(process.env.ACCESSIBILITY_FAIL_ON_CRITICAL || "true") !== "false";
  const maxSerious = Number(process.env.ACCESSIBILITY_MAX_SERIOUS || 0);
  const highCount = dedupedIssues.filter((i) => i.severityLabel === "High").length;
  const mediumCount = dedupedIssues.filter((i) => i.severityLabel === "Medium").length;
  const lowCount = dedupedIssues.filter((i) => i.severityLabel === "Low").length;
  const criticalCount = dedupedIssues.filter((i) => i.severity === "critical").length;
  const seriousCount = dedupedIssues.filter((i) => i.severity === "serious").length;
  const gatePassed = (!failOnCritical || criticalCount === 0) && seriousCount <= maxSerious;

  const topRules = new Map();
  for (const issue of dedupedIssues) {
    const item = topRules.get(issue.issueRule) || {
      rule: issue.issueRule,
      severity: issue.severity,
      count: 0
    };
    item.count += issue.frequency;
    if (severityScore(issue.severity) > severityScore(item.severity)) item.severity = issue.severity;
    topRules.set(issue.issueRule, item);
  }
  const top10 = Array.from(topRules.values())
    .sort((a, b) => {
      const sev = severityScore(b.severity) - severityScore(a.severity);
      if (sev !== 0) return sev;
      return b.count - a.count;
    })
    .slice(0, 10);

  const reportsBaseDir = path.resolve(process.cwd(), "reports", "accessibility");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "accessibility-report-"));
  const htmlPath = path.join(tempDir, "final-accessibility-report.html");
  const tempPdfPath = path.join(tempDir, "final-accessibility-report.pdf");
  const finalPdfPath = path.join(reportsBaseDir, "final-accessibility-report.pdf");

  const html = [];
  html.push("<!doctype html><html><head><meta charset=\"utf-8\"><title>Final Accessibility Report</title>");
  html.push("<style>");
  html.push("body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;line-height:1.45;}");
  html.push("h1,h2,h3{margin:10px 0 6px;} .item{border:1px solid #ddd;padding:10px;margin:10px 0;border-radius:6px;page-break-inside:avoid;}");
  html.push(".label{font-weight:700;} .meta{margin:3px 0;} img{max-width:100%;height:auto;border:1px solid #ddd;border-radius:4px;}");
  html.push(".small{font-size:12px;color:#444;word-break:break-all;} .ok{color:#0a7d00;} .fail{color:#a61d24;}");
  html.push("table{border-collapse:collapse;width:100%;margin:8px 0;} th,td{border:1px solid #ddd;padding:6px;text-align:left;}");
  html.push("pre{background:#f5f5f5;padding:8px;border-radius:4px;white-space:pre-wrap;}");
  html.push(".cover{display:flex;flex-direction:column;justify-content:center;min-height:95vh;}");
  html.push(".cover h1{font-size:32px;margin-bottom:12px;} .cover p{font-size:15px;}");
  html.push(".section-break{page-break-before:always;} .toc li{margin:4px 0;}");
  html.push("</style></head><body>");

  // Cover page
  html.push("<section class='cover'>");
  html.push("<h1>Final Accessibility Report</h1>");
  html.push(`<p><strong>Generated:</strong> ${new Date().toISOString()}</p>`);
  html.push(`<p><strong>Scope:</strong> ${reports.length} scanned pages</p>`);
  html.push(`<p><strong>Overall Gate:</strong> <span class="${gatePassed ? "ok" : "fail"}">${gatePassed ? "PASS" : "FAIL"}</span></p>`);
  html.push("</section>");

  // Table of contents
  html.push("<section class='section-break'>");
  html.push("<h2>Contents</h2>");
  html.push("<ol class='toc'>");
  html.push("<li>Executive Summary</li>");
  html.push("<li>Top 10 Priority Rules</li>");
  html.push("<li>Detailed Findings (Appendix)</li>");
  html.push("</ol>");
  html.push("</section>");

  // Executive summary
  html.push("<section class='section-break'>");
  html.push("<h2>Executive Summary</h2>");
  html.push(
    `<p><strong>Gate status:</strong> <span class="${gatePassed ? "ok" : "fail"}">${gatePassed ? "PASS" : "FAIL"}</span></p>`
  );
  html.push("<table><tbody>");
  html.push(`<tr><td><strong>Pages scanned</strong></td><td>${reports.length}</td></tr>`);
  html.push(`<tr><td><strong>Unique issues</strong></td><td>${dedupedIssues.length}</td></tr>`);
  html.push(`<tr><td><strong>High issues</strong></td><td>${highCount}</td></tr>`);
  html.push(`<tr><td><strong>Medium issues</strong></td><td>${mediumCount}</td></tr>`);
  html.push(`<tr><td><strong>Low issues</strong></td><td>${lowCount}</td></tr>`);
  html.push(`<tr><td><strong>Critical issues (raw)</strong></td><td>${criticalCount}</td></tr>`);
  html.push(`<tr><td><strong>Serious issues (raw)</strong></td><td>${seriousCount}</td></tr>`);
  html.push(`<tr><td><strong>Regression (new/existing/fixed)</strong></td><td>${regression.added} / ${regression.existing} / ${regression.fixed}</td></tr>`);
  html.push(`<tr><td><strong>Gate config</strong></td><td>fail_on_critical=${failOnCritical}, max_serious=${maxSerious}</td></tr>`);
  html.push("</tbody></table>");
  html.push(
    `<p>${gatePassed ? "Release gate passed under current configuration." : "Release gate failed. Critical and/or serious accessibility issues exceed configured threshold."}</p>`
  );
  html.push("</section>");

  // Prioritized rule summary
  html.push("<section class='section-break'>");
  html.push("<h2>Top 10 Priority Rules</h2><table><thead><tr><th>Rule</th><th>Severity</th><th>Occurrences</th></tr></thead><tbody>");
  for (const top of top10) {
    html.push(`<tr><td>${htmlEscape(top.rule)}</td><td>${htmlEscape(severityLabel(top.severity))}</td><td>${top.count}</td></tr>`);
  }
  html.push("</tbody></table>");
  html.push("</section>");

  // Appendix detailed findings
  html.push("<section class='section-break'>");
  html.push("<h2>Detailed Findings (Appendix)</h2>");
  dedupedIssues.forEach((issue, idx) => {
    const screenshotHtml = issue.screenshotFileName
      ? `<img src="${pathToFileURL(path.resolve(process.cwd(), "reports", "accessibility", "evidence", issue.screenshotFileName)).href}" alt="Issue ${idx + 1} screenshot" />`
      : "<div class=\"small\">Screenshot: Not captured</div>";
    html.push("<div class=\"item\">");
    html.push(`<h3>No-${idx + 1}</h3>`);
    html.push(`<div class="meta"><span class="label">Severity-</span> ${htmlEscape(issue.severityLabel)} (raw: ${htmlEscape(issue.severity)}, count: ${issue.frequency})</div>`);
    html.push(`<div class="meta"><span class="label">Url-</span> ${htmlEscape(issue.url)}</div>`);
    html.push(`<div class="meta"><span class="label">Issue-</span> ${htmlEscape(issue.issueRule)} | ${htmlEscape(issue.issueSummary.replace(/\n/g, " "))}</div>`);
    html.push(`<div class="meta"><span class="label">Selector-</span> <span class="small">${htmlEscape(issue.selector)}</span></div>`);
    html.push(
      `<div class="meta"><span class="label">WCAG criteria-</span> ${htmlEscape(
        (issue.wcagCriteria || []).join(", ") || "Not specified"
      )}</div>`
    );
    html.push(
      `<div class="meta"><span class="label">Compliance tags-</span> <span class="small">${htmlEscape(
        (issue.tags || []).join(", ") || "Not specified"
      )}</span></div>`
    );
    html.push(`<div class="meta"><span class="label">Screenshot-</span></div>${screenshotHtml}`);
    html.push(`<div class="meta"><span class="label">Possible fix-</span> ${htmlEscape(issue.possibleFix)}</div>`);
    html.push("<div class=\"meta\"><span class=\"label\">Suggested snippet-</span></div>");
    html.push(`<pre>${htmlEscape(fixSnippet(issue.issueRule))}</pre>`);
    html.push("</div>");
  });
  html.push("</section></body></html>");

  await fs.writeFile(htmlPath, html.join("\n"), "utf8");
  await generatePdfFromHtml(htmlPath, tempPdfPath);

  await removeDirectoryContents(reportsBaseDir);
  await fs.mkdir(reportsBaseDir, { recursive: true });
  await fs.copyFile(tempPdfPath, finalPdfPath);
  await fs.rm(tempDir, { recursive: true, force: true });

  console.log(`Final accessibility report: ${finalPdfPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
