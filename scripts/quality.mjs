import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const qualityDir = join(root, "build/quality");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(`${command} failed to start: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function fail(message) {
  console.error(`Quality gate failed: ${message}`);
  process.exit(1);
}

async function executable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function toolPath(tool) {
  const wrapper = join(root, ".swarmforge/bin", tool);
  const helper = join(root, "swarmforge/scripts/swarm_tool.sh");
  if (await executable(helper)) {
    let status = run(helper, ["require", tool]);
    if (status !== 0) status = run(helper, ["ensure", tool]);
    if (status !== 0 || !(await executable(wrapper))) fail(`${tool} wrapper is unavailable`);
    return wrapper;
  }
  const local = join(root, "node_modules/.bin", tool);
  if (!(await executable(local))) fail(`${tool} is unavailable; run npm ci --ignore-scripts`);
  return local;
}

async function collect(rootName, excluded = new Set()) {
  const base = join(root, rootName);
  const files = [];
  async function visit(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !["build", "coverage", "generated", "node_modules", "reports"].includes(entry.name)) await visit(path);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const name = relative(root, path).split(sep).join("/");
        if (!excluded.has(name) && !/(^|\/)(test|tests|e2e)(\/|$)/.test(name)) files.push(name);
      }
    }
  }
  await visit(base);
  return files.sort();
}

async function freshCoverage() {
  const status = run("npm", ["run", "test:coverage"]);
  if (status !== 0) process.exit(status);
  const path = join(root, "coverage/coverage-final.json");
  let data;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail(`missing or invalid Istanbul coverage: ${path}`);
  }
  const files = Object.keys(data).map((file) => file.replaceAll("\\", "/"));
  if (files.length === 0) fail("Istanbul coverage is empty");
  return files;
}

async function crap() {
  await mkdir(qualityDir, { recursive: true });
  const discovered = await collect("lib");
  const covered = await freshCoverage();
  const sourceFiles = discovered.filter((source) => covered.some((file) => file.endsWith(source)));
  if (sourceFiles.length === 0) fail("CRAP source scope is empty");
  const tool = await toolPath("crap-typescript");
  const status = run(tool, [
    "--package-manager", "npm",
    "--test-runner", "vitest",
    "--format", "json",
    "--output", "build/quality/crap.json",
    "--junit-report", "build/quality/crap.junit.xml",
    "--threshold", "10",
    ...sourceFiles,
  ]);
  if (status !== 0) process.exit(status);
  const reportPath = join(qualityDir, "crap.json");
  let report;
  try {
    const text = await readFile(reportPath, "utf8");
    if (!text.trim() || text.includes("N/A")) fail("CRAP report is empty or contains N/A");
    report = JSON.parse(text);
  } catch (error) {
    if (error?.message?.startsWith("Quality gate failed:")) throw error;
    fail(`missing or invalid CRAP report: ${reportPath}`);
  }
  const methods = Array.isArray(report?.methods) ? report.methods : [];
  if (methods.length === 0) fail("CRAP analysis is empty");
  const analyzed = new Set(methods.map((method) => String(method?.src ?? "").replaceAll("\\", "/")));
  for (const source of sourceFiles) {
    if (!analyzed.has(source)) fail(`CRAP report analyzed no requested source: ${source}`);
  }
  if (methods.some((method) => !Number.isFinite(Number(method?.crap)) || !Number.isFinite(Number(method?.cov)))) {
    fail("CRAP report contains a non-numeric metric");
  }
}

async function dry() {
  await mkdir(qualityDir, { recursive: true });
  const tool = await toolPath("jscpd");
  const output = join(qualityDir, "jscpd");
  const status = run(tool, [
    "--config", ".jscpd.json",
    "--reporters", "console,json,html,threshold",
    "--output", output,
    "--threshold", "0",
    "--workers", "4",
    "--no-tips",
    "lib", "app",
  ]);
  if (status !== 0) process.exit(status);
  const reportPath = join(output, "jscpd-report.json");
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch {
    fail(`missing or invalid jscpd report: ${reportPath}`);
  }
  const total = report?.statistics?.total;
  if (!total || typeof total.sources !== "number" || total.sources === 0) fail("jscpd analysis is empty");
  const percentage = Number(total.percentage);
  if (!Number.isFinite(percentage)) fail("jscpd report is missing a numeric duplication percentage");
  if (percentage > 0) fail(`jscpd reported ${total.percentage}% duplication despite a zero threshold`);
}

async function all() {
  let status = run("npm", ["run", "quality:crap"]);
  if (status !== 0) process.exit(status);
  status = run("npm", ["run", "quality:dry"]);
  if (status !== 0) process.exit(status);
}

const [command] = process.argv.slice(2);
if (command === "mutation") {
  const tool = await toolPath("stryker");
  await mkdir(qualityDir, { recursive: true });
  await rm(join(qualityDir, "stryker-tmp"), { recursive: true, force: true });
  await rm(join(qualityDir, "stryker.json"), { force: true });
  await rm(join(qualityDir, "stryker.html"), { force: true });
  process.exit(run(tool, ["run", "stryker.config.json", ...process.argv.slice(3)]));
} else if (command === "crap") {
  await crap();
} else if (command === "dry") {
  await dry();
} else if (command === "all") {
  await all();
} else {
  console.error("Usage: node scripts/quality.mjs <mutation|crap|dry|all>");
  process.exit(1);
}
