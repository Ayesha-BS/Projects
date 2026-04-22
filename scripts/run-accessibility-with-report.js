const { spawnSync } = require("child_process");

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

function main() {
  const mode = (process.argv[2] || "basic").toLowerCase();
  const steps = stepsForMode(mode);

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
