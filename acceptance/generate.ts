import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type { Feature } from "./runtime.ts";

function modulePath(fromDir: string, target: string) {
  const path = relative(fromDir, target).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

export function featureMetadataSlug(featurePath: string) {
  let slug = "";
  let previousHyphen = false;
  for (const character of featurePath.toLowerCase()) {
    if ((character >= "a" && character <= "z") || (character >= "0" && character <= "9")) {
      slug += character;
      previousHyphen = false;
    } else if (!previousHyphen && slug) {
      slug += "-";
      previousHyphen = true;
    }
  }
  return slug.replace(/^-+|-+$/g, "");
}

export async function generateEntrypoint(irPath: string, outputDir: string, featurePath?: string) {
  const feature = JSON.parse(await readFile(irPath, "utf8")) as Feature;
  const stem = basename(irPath, extname(irPath));
  const sourcePath = featurePath ?? `features/${stem}.feature`;
  const runtimeImport = modulePath(outputDir, join(process.cwd(), "acceptance/runtime.ts"));
  const stepsImport = modulePath(outputDir, join(process.cwd(), "acceptance/steps.ts"));
  const irImport = modulePath(outputDir, irPath);
  const source = `import { readFile } from "node:fs/promises";
import { runFeature } from "${runtimeImport}";
import { steps } from "${stepsImport}";
const feature = JSON.parse(await readFile(new URL(${JSON.stringify(irImport)}, import.meta.url), "utf8"));
await runFeature(feature, steps, process.env.BASE_URL ?? "http://127.0.0.1:3000");
`;
  const output = join(outputDir, `${stem}.test.mjs`);
  const generatedFile = relative(process.cwd(), output).split(sep).join("/");
  const implementationHash = `sha256:${createHash("sha256").update(source).digest("hex")}`;
  await mkdir(join(outputDir, "metadata"), { recursive: true });
  await writeFile(output, source);
  await writeFile(join(outputDir, `metadata/${featureMetadataSlug(sourcePath)}.json`), JSON.stringify({
    schema_version: 1,
    feature_path: sourcePath,
    ir_path: relative(process.cwd(), irPath).split(sep).join("/"),
    implementation_hash: implementationHash,
    hash_scope: "generated_files",
    generated_files: [generatedFile],
  }, null, 2) + "\n");
  return output;
}
