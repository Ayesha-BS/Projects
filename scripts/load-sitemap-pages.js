const fs = require("fs/promises");
const path = require("path");

const SITEMAP_URL = process.env.SITEMAP_URL;
const PROFILE = (process.env.SITEMAP_PROFILE || "full").toLowerCase();
const PROFILE_LIMITS = { quick: 5, pr: 15, full: Number(process.env.SITEMAP_MAX_URLS || 25) };
const MAX_URLS = PROFILE_LIMITS[PROFILE] || PROFILE_LIMITS.full;
const TIMEOUT_MS = Number(process.env.SITEMAP_TIMEOUT_MS || 30000);

function sanitizeName(url, index) {
  try {
    const parsed = new URL(url);
    const cleanPath = parsed.pathname.replace(/\/+$/, "") || "/";
    const slug = cleanPath === "/" ? "home" : cleanPath.replace(/\//g, "-").replace(/^-+/, "");
    return `${String(index + 1).padStart(2, "0")}-${slug}`;
  } catch (error) {
    return `${String(index + 1).padStart(2, "0")}-page`;
  }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractLocs(xml) {
  const matches = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)];
  return matches.map((match) => match[1].trim());
}

async function readSitemapUrls(rootSitemapUrl) {
  const visited = new Set();
  const urlQueue = [rootSitemapUrl];
  const pageUrls = [];
  const rootHost = new URL(rootSitemapUrl).host;

  while (urlQueue.length && pageUrls.length < MAX_URLS) {
    const current = urlQueue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const xml = await fetchWithTimeout(current);
    const locs = extractLocs(xml);
    for (const loc of locs) {
      try {
        const parsed = new URL(loc);
        if (parsed.host !== rootHost) {
          continue;
        }

        if (loc.endsWith(".xml")) {
          if (!visited.has(loc)) {
            urlQueue.push(loc);
          }
        } else if (!pageUrls.includes(loc)) {
          pageUrls.push(loc);
          if (pageUrls.length >= MAX_URLS) {
            break;
          }
        }
      } catch (error) {
        // Ignore malformed sitemap entries.
      }
    }
  }

  return pageUrls;
}

async function main() {
  if (!SITEMAP_URL) {
    throw new Error("SITEMAP_URL is required. Example: SITEMAP_URL=https://example.com/sitemap.xml");
  }

  const urls = await readSitemapUrls(SITEMAP_URL);
  if (urls.length === 0) {
    throw new Error("No URLs discovered from sitemap.");
  }

  const pages = urls.map((url, index) => ({
    name: sanitizeName(url, index),
    path: url
  }));

  const outputPath = path.resolve(process.cwd(), "tests", "helpers", "pagesToScan.generated.json");
  await fs.writeFile(outputPath, JSON.stringify(pages, null, 2), "utf8");

  console.log(`Generated ${pages.length} sitemap pages at ${outputPath} (profile=${PROFILE})`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
