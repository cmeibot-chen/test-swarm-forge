import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { featureMetadataSlug, generateEntrypoint } from "../acceptance/generate";

it("uses the APS feature slug and generated-file metadata contract", async () => {
  await mkdir(join(process.cwd(), "tmp"), { recursive: true });
  const workDir = await mkdtemp(join(process.cwd(), "tmp", "acceptance-generator-"));
  try {
    const irPath = join(workDir, "hello-world.json");
    const outputDir = join(workDir, "generated");
    await writeFile(irPath, JSON.stringify({
      name: "Hello World",
      scenarios: [{ name: "greeting", steps: [], examples: [] }],
    }));

    await generateEntrypoint(irPath, outputDir, "features/Hunt The Wumpus.feature");

    const metadata = JSON.parse(await readFile(join(
      outputDir,
      "metadata",
      `${featureMetadataSlug("features/Hunt The Wumpus.feature")}.json`,
    ), "utf8"));
    expect(metadata).toMatchObject({
      schema_version: 1,
      feature_path: "features/Hunt The Wumpus.feature",
      ir_path: expect.stringContaining("acceptance-generator-"),
      implementation_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      hash_scope: "generated_files",
    });
    expect(metadata.generated_files).toEqual([expect.stringContaining("hello-world.test.mjs")]);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
