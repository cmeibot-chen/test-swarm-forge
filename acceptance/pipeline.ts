import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { generateEntrypoint } from "./generate.ts";

const root = resolve(process.cwd());
const workDir = join(root, "build/acceptance");
const feature = join(root, "features/todos.feature");
const ir = join(workDir, "ir/todos.json");
const dry = join(workDir, "dry/todos.json");
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

await mkdir(join(workDir, "ir"), { recursive: true });
await mkdir(join(workDir, "dry"), { recursive: true });
await rm(generated, { recursive: true, force: true });
for (const tool of ["gherkin-parser", "ir-dry-checker"]) {
  const path = join(root, `.swarmforge/bin/${tool}`);
  await ensureTool(tool, path);
}
execFileSync(join(root, ".swarmforge/bin/gherkin-parser"), [feature, ir], { stdio: "inherit" });
execFileSync(join(root, ".swarmforge/bin/ir-dry-checker"), [ir, dry], { stdio: "inherit" });
const entrypoint = await generateEntrypoint(ir, generated);
execFileSync(join(root, "node_modules/.bin/tsx"), [entrypoint], {
  stdio: "inherit", env: { ...process.env, BASE_URL: process.env.BASE_URL ?? "http://127.0.0.1:3000" },
});
console.log(`Acceptance passed: ${feature}`);
