const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function run(command) {
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit"
  });
  return typeof result.status === "number" ? result.status : 1;
}

function stepsForMode(mode) {
  if (mode === "sitemap") {
    return ["npm run sitemap:load", "npm run test:accessibility:full:raw"];
  }
  if (mode === "full") {
    return ["npm run test:accessibility:full:raw"];
  }
  return ["npm run test:accessibility:raw"];
}

function clearEvidenceDirectory() {
  const evidenceDir = path.resolve(process.cwd(), "reports", "accessibility", "evidence");
  try {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors; test run will recreate directory as needed.
  }
}

function main() {
  const mode = (process.argv[2] || "basic").toLowerCase();
  const steps = stepsForMode(mode);
  clearEvidenceDirectory();

  let exitCode = 0;
  for (const step of steps) {
    const code = run(step);
    if (code !== 0 && exitCode === 0) {
      exitCode = code;
    }
  }

  const reportCode = run("npm run report:accessibility:developer");
  if (reportCode !== 0 && exitCode === 0) {
    exitCode = reportCode;
  }

  process.exit(exitCode);
}

main();
