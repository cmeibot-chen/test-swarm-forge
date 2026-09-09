import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type { Feature } from "./runtime.ts";

function modulePath(fromDir: string, target: string) {
  const path = relative(fromDir, target).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

export async function generateEntrypoint(irPath: string, outputDir: string, featurePath?: string) {
  const feature = JSON.parse(await readFile(irPath, "utf8")) as Feature;
  const stem = basename(irPath, extname(irPath));
  const sourcePath = featurePath ?? `features/${stem}.feature`;
  const runtimeImport = modulePath(outputDir, join(process.cwd(), "acceptance/runtime.ts"));
  const stepsImport = modulePath(outputDir, join(process.cwd(), "acceptance/steps.ts"));
  const irImport = modulePath(outputDir, irPath);
  await mkdir(join(outputDir, "metadata"), { recursive: true });
  const source = `import { readFile } from "node:fs/promises";
import { runFeature } from "${runtimeImport}";
import { steps } from "${stepsImport}";
const feature = JSON.parse(await readFile(new URL(${JSON.stringify(irImport)}, import.meta.url), "utf8"));
await runFeature(feature, steps, process.env.BASE_URL ?? "http://127.0.0.1:3000");
`;
  const output = join(outputDir, `${stem}.test.mjs`);
  await writeFile(output, source);
  await writeFile(join(outputDir, `metadata/${stem}.json`), JSON.stringify({
    feature_path: sourcePath,
    implementation_hash: createHash("sha256").update(source).digest("hex"),
    scenarios: feature.scenarios.map((scenario, index) => ({ index, name: scenario.name })),
  }, null, 2) + "\n");
  return output;
}
