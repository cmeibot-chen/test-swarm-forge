import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Feature } from "./runtime.ts";

export async function generateEntrypoint(irPath: string, outputDir: string) {
  const feature = JSON.parse(await readFile(irPath, "utf8")) as Feature;
  await mkdir(join(outputDir, "metadata"), { recursive: true });
  const source = `import { readFile } from "node:fs/promises";
import { runFeature } from "../../../acceptance/runtime.ts";
import { steps } from "../../../acceptance/steps.ts";
const feature = JSON.parse(await readFile(new URL("../ir/todos.json", import.meta.url), "utf8"));
await runFeature(feature, steps, process.env.BASE_URL ?? "http://127.0.0.1:3000");
`;
  const output = join(outputDir, "todos.test.mjs");
  await writeFile(output, source);
  await writeFile(join(outputDir, "metadata/todos.json"), JSON.stringify({
    feature_path: "features/todos.feature",
    implementation_hash: createHash("sha256").update(source).digest("hex"),
    scenarios: feature.scenarios.map((scenario, index) => ({ index, name: scenario.name })),
  }, null, 2) + "\n");
  return output;
}
