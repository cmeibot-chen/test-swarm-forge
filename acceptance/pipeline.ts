import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { generateEntrypoint } from "./generate.ts";
import { restorePostgres } from "./postgres.ts";

const root = resolve(process.cwd());
const workDir = join(root, "build/acceptance");
const generated = join(workDir, "generated");
const toolScript = [
  process.env.SWARMFORGE_TOOL_SCRIPT,
  join(root, "swarmforge/scripts/swarm_tool.sh"),
  resolve(root, "../../swarmforge/scripts/swarm_tool.sh"),
].filter((path): path is string => typeof path === "string" && existsSync(path))[0];

async function ensureTool(tool: string, path: string) {
  try {
    return await readFile(path);
  } catch {
    if (!toolScript) throw new Error(`Missing ${tool} wrapper and swarm_tool.sh`);
    execFileSync(toolScript, ["ensure", tool], { stdio: "inherit" });
    return readFile(path);
  }
}

const featureEntries = (await readdir(join(root, "features"), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name) === ".feature")
  .sort((left, right) => left.name.localeCompare(right.name));
if (featureEntries.length === 0) throw new Error("No Gherkin feature files found");

await rm(workDir, { recursive: true, force: true });
await mkdir(join(workDir, "ir"), { recursive: true });
await mkdir(join(workDir, "dry"), { recursive: true });
await mkdir(generated, { recursive: true });
const parser = join(root, ".swarmforge/bin/gherkin-parser");
const dryChecker = join(root, ".swarmforge/bin/ir-dry-checker");
for (const [tool, path] of [["gherkin-parser", parser], ["ir-dry-checker", dryChecker]] as const) {
  await ensureTool(tool, path);
}

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
try {
  for (const entry of featureEntries) {
    const feature = join(root, "features", entry.name);
    const stem = basename(entry.name, extname(entry.name));
    const ir = join(workDir, "ir", `${stem}.json`);
    const dry = join(workDir, "dry", `${stem}.json`);
    execFileSync(parser, [feature, ir], { stdio: "inherit" });
    execFileSync(dryChecker, [ir, dry], { stdio: "inherit" });
    const entrypoint = await generateEntrypoint(ir, generated, relative(root, feature));
    execFileSync(join(root, "node_modules/.bin/tsx"), [entrypoint], {
      stdio: "inherit", env: { ...process.env, BASE_URL: baseURL },
    });
    console.log(`Acceptance passed: ${feature}`);
  }
} finally {
  await restorePostgres(baseURL);
}
