const fs = require("fs");
const path = require("path");

const DEFAULT_PAGES = [
  { name: "Home", path: "/" },
  { name: "Login", path: "/login" }
];

function loadGeneratedPages() {
  const generatedPath = path.resolve(__dirname, "pagesToScan.generated.json");
  if (!fs.existsSync(generatedPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(generatedPath, "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

const PAGES_TO_SCAN = loadGeneratedPages() || DEFAULT_PAGES;

module.exports = { PAGES_TO_SCAN };
