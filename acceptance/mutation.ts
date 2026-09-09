import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

function withoutMutationStamp(source: string) {
  const lines = source.split(/\r?\n/);
  const begin = lines.findIndex((line) => line === "# acceptance-mutation-manifest-begin");
  const end = lines.findIndex((line, index) => index > begin && line === "# acceptance-mutation-manifest-end");
  if (begin <= 0 || end < 0 || !lines[begin - 1].startsWith("# mutation-stamp:")) return source;
  lines.splice(begin - 1, end - begin + 2);
  if (lines[begin - 1] === "") lines.splice(begin - 1, 1);
  return lines.join("\n");
}

await rm(workDir, { recursive: true, force: true });
await ensureTool("gherkin-parser", parser);
await ensureTool("gherkin-mutator", mutator);
await mkdir(workDir, { recursive: true });
const featureEntries = (await readdir(join(root, "features"), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name) === ".feature")
  .sort((left, right) => left.name.localeCompare(right.name));
if (featureEntries.length === 0) throw new Error("No Gherkin feature files found");

for (const entry of featureEntries) {
  const feature = join(root, "features", entry.name);
  const stem = basename(entry.name, extname(entry.name));
  const featureWorkDir = join(workDir, stem);
  const featureInput = join(featureWorkDir, "input.feature");
  const ir = join(featureWorkDir, "ir", `${stem}.json`);
  const generated = join(featureWorkDir, "generated");
  await mkdir(featureWorkDir, { recursive: true });
  await mkdir(join(featureWorkDir, "ir"), { recursive: true });
  await writeFile(featureInput, withoutMutationStamp(await readFile(feature, "utf8")));
  execFileSync(parser, [featureInput, ir], { stdio: "inherit" });
  await generateEntrypoint(ir, generated, relative(root, feature));
  execFileSync(mutator, [
    "--feature", featureInput,
    "--work-dir", featureWorkDir,
    "--generated-dir", generated,
    "--level", "hard",
    "--workers", "4",
    "--runner-worker", "tsx acceptance/runner-worker.ts",
  ], {
    stdio: "inherit",
    env: {
      ...process.env,
      SWARMFORGE_ACCEPTANCE_ENV: process.env.SWARMFORGE_ACCEPTANCE_ENV ?? "test",
      SWARMFORGE_TEST_RUN_ID: process.env.SWARMFORGE_TEST_RUN_ID ?? ("acceptance-mutation-" + process.pid),
      SWARMFORGE_ACCEPTANCE_LOCK_DIR: workDir,
    },
  });
}
