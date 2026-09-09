import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { generateEntrypoint } from "./generate.ts";

const root = resolve(process.cwd());
const workDir = join(root, "build/acceptance-mutation");
const parser = join(root, ".swarmforge/bin/gherkin-parser");
const mutator = join(root, ".swarmforge/bin/gherkin-mutator");
const toolScript = [
  process.env.SWARMFORGE_TOOL_SCRIPT,
  join(root, "swarmforge/scripts/swarm_tool.sh"),
  resolve(root, "../../swarmforge/scripts/swarm_tool.sh"),
].filter((path): path is string => typeof path === "string" && existsSync(path))[0];

async function ensureTool(tool: string, path: string) {
  try {
    await readFile(path);
  } catch {
    if (!toolScript) throw new Error(`Missing ${tool} wrapper and swarm_tool.sh`);
    execFileSync(toolScript, ["ensure", tool], { stdio: "inherit" });
  }
}

function testBaseURL(value: string) {
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (!local && process.env.SWARMFORGE_ALLOW_REMOTE_TEST_URL !== "1") {
    throw new Error(`Acceptance mutation requires a local BASE_URL, got ${url.origin}`);
  }
  if (process.env.NODE_ENV === "production" || process.env.SWARMFORGE_ACCEPTANCE_ENV === "production") {
    throw new Error("Acceptance mutation refuses a production target");
  }
  return value.replace(/\/+$/, "");
}

await rm(workDir, { recursive: true, force: true });
await ensureTool("gherkin-parser", parser);
await ensureTool("gherkin-mutator", mutator);
await mkdir(workDir, { recursive: true });
const baseURL = testBaseURL(process.env.BASE_URL ?? "http://127.0.0.1:3000");
const runner = join(root, "node_modules/.bin/tsx");
const mutationEnv = {
  ...process.env,
  BASE_URL: baseURL,
  SWARMFORGE_ACCEPTANCE_ENV: process.env.SWARMFORGE_ACCEPTANCE_ENV ?? "test",
  SWARMFORGE_TEST_RUN_ID: process.env.SWARMFORGE_TEST_RUN_ID ?? ("acceptance-mutation-" + process.pid),
  SWARMFORGE_ACCEPTANCE_LOCK_DIR: workDir,
};
const featureEntries = (await readdir(join(root, "features"), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name) === ".feature")
  .sort((left, right) => left.name.localeCompare(right.name));
if (featureEntries.length === 0) throw new Error("No Gherkin feature files found");

for (const entry of featureEntries) {
  const feature = join(root, "features", entry.name);
  const featurePath = relative(root, feature).split("\\").join("/");
  const stem = basename(entry.name, extname(entry.name));
  const featureWorkDir = join(workDir, stem);
  const ir = join(featureWorkDir, "ir", `${stem}.json`);
  const generated = join(featureWorkDir, "generated");
  await mkdir(featureWorkDir, { recursive: true });
  await mkdir(join(featureWorkDir, "ir"), { recursive: true });
  execFileSync(parser, [feature, ir], { stdio: "inherit" });
  const entrypoint = await generateEntrypoint(ir, generated, featurePath);
  execFileSync(runner, [entrypoint], { stdio: "inherit", env: mutationEnv });
  execFileSync(mutator, [
    "--feature", featurePath,
    "--work-dir", featureWorkDir,
    "--generated-dir", generated,
    "--level", "hard",
    "--workers", "4",
    "--runner-worker", "tsx acceptance/runner-worker.ts",
  ], {
    stdio: "inherit",
    env: mutationEnv,
  });
}
