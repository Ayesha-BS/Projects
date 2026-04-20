const fs = require("fs/promises");
const path = require("path");

function sanitizeFileName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function remediationHint(violation) {
  const id = violation.id || "";
  const description = `${violation.help || ""} ${violation.description || ""}`.toLowerCase();

  if (id.includes("color") || description.includes("contrast")) {
    return "Increase color contrast for text/UI components to WCAG AA minimum ratio (4.5:1 for normal text).";
  }
  if (id.includes("label") || description.includes("form")) {
    return "Add programmatic labels (`label`, `aria-label`, or `aria-labelledby`) for all form controls.";
  }
  if (id.includes("keyboard") || description.includes("keyboard")) {
    return "Ensure full keyboard navigation with visible focus order and no keyboard traps.";
  }
  if (id.includes("aria") || description.includes("aria")) {
    return "Correct ARIA roles/states to match element purpose and avoid invalid ARIA usage.";
  }
  if (id.includes("image") || id.includes("alt") || description.includes("image")) {
    return "Provide meaningful alternative text for informative images and empty alt for decorative images.";
  }
  return "Review the axe help URL and WCAG mapping, then implement semantic HTML and accessible names for affected elements.";
}

function createMarkdownReport({ pageName, pagePath, url, scanResults, reportViolations }) {
  const lines = [];
  lines.push(`# Accessibility QA Report - ${pageName}`);
  lines.push("");
  lines.push(`- Page path: \`${pagePath}\``);
  lines.push(`- URL tested: \`${url}\``);
  lines.push(`- Total violations found: **${scanResults.violations.length}**`);
  lines.push(`- Reported violations: **${reportViolations.length}**`);
  lines.push("");

  if (!reportViolations.length) {
    lines.push("## Result");
    lines.push("");
    lines.push("PASS (No configured reportable violations found by automated scan)");
    lines.push("");
  } else {
    lines.push("## Result");
    lines.push("");
    lines.push("FAIL (Accessibility issues detected)");
    lines.push("");
  }

  lines.push("## Developer Action Items");
  lines.push("");

  if (!reportViolations.length) {
    lines.push("- No blocking issues from this automated check.");
  } else {
    for (const violation of reportViolations) {
      lines.push(`### ${violation.id} (${violation.impact || "unknown impact"})`);
      lines.push("");
      lines.push(`- Why this matters: ${violation.help}`);
      lines.push(`- Rule info: ${violation.helpUrl}`);
      lines.push(`- Suggested fix: ${remediationHint(violation)}`);
      lines.push(`- WCAG tags: ${(violation.tags || []).join(", ") || "N/A"}`);
      lines.push(`- Affected nodes: ${violation.nodes?.length || 0}`);
      lines.push("");

      for (const [index, node] of (violation.nodes || []).entries()) {
        lines.push(`  - Node ${index + 1}: \`${(node.target || []).join(" | ")}\``);
        lines.push(`    - Failure summary: ${node.failureSummary || "N/A"}`);
      }
      lines.push("");
    }
  }

  lines.push("## Inclusive Testing Note");
  lines.push("");
  lines.push(
    "- Automated checks improve coverage for users with weak eyesight and physical disabilities, but they do not prove full accessibility for all users."
  );
  lines.push(
    "- Add manual QA for keyboard-only usage, screen reader behavior (NVDA/JAWS/VoiceOver), zoom at 200%, and high-contrast mode."
  );
  lines.push("");

  return lines.join("\n");
}

async function writeAccessibilityReport({ pageName, pagePath, url, scanResults, reportViolations }) {
  const reportsDir = path.resolve(process.cwd(), "reports", "accessibility");
  await fs.mkdir(reportsDir, { recursive: true });

  const baseName = sanitizeFileName(pageName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const markdownPath = path.join(reportsDir, `${timestamp}-${baseName}.md`);
  const jsonPath = path.join(reportsDir, `${timestamp}-${baseName}.json`);

  const markdown = createMarkdownReport({
    pageName,
    pagePath,
    url,
    scanResults,
    reportViolations
  });

  await fs.writeFile(markdownPath, markdown, "utf8");
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        pageName,
        pagePath,
        url,
        totalViolations: scanResults.violations.length,
        reportViolationsCount: reportViolations.length,
        reportViolations
      },
      null,
      2
    ),
    "utf8"
  );

  return { markdownPath, jsonPath };
}

module.exports = { writeAccessibilityReport };
