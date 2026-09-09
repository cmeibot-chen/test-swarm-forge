import { createInterface } from "node:readline";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runFeature, type Feature } from "./runtime.ts";
import { restorePostgres } from "./postgres.ts";
import { steps } from "./steps.ts";

const lockTTL = Number(process.env.SWARMFORGE_MUTATION_LOCK_TTL_MS ?? 15 * 60 * 1_000);
const lockPoll = 25;

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function staleLock(lock: string) {
  try {
    const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8")) as { pid?: number; createdAt?: number };
    const age = Date.now() - Number(owner.createdAt ?? 0);
    return age > lockTTL && !pidAlive(Number(owner.pid));
  } catch {
    try {
      return Date.now() - (await stat(lock)).mtimeMs > lockTTL;
    } catch {
      return false;
    }
  }
}

async function withMutationLock(workDir: string, run: () => Promise<void>) {
  const lock = join(process.env.SWARMFORGE_ACCEPTANCE_LOCK_DIR ?? dirname(workDir), ".runner.lock");
  const token = [process.pid, Date.now(), Math.random().toString(36).slice(2)].join("-");
  let acquired = false;
  while (!acquired) {
    try {
      await mkdir(lock);
      acquired = true;
      await writeFile(join(lock, "owner.json"), JSON.stringify({
        pid: process.pid,
        token,
        createdAt: Date.now(),
      }) + "\n");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await staleLock(lock)) await rm(lock, { recursive: true, force: true });
      else await new Promise((resolve) => setTimeout(resolve, lockPoll));
    }
  }
  try {
    await run();
  } finally {
    try {
      const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8")) as { token?: string };
      if (owner.token === token) await rm(lock, { recursive: true, force: true });
    } catch {
      await rm(lock, { recursive: true, force: true });
    }
  }
}

function testBaseURL(value: string) {
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (!local && process.env.SWARMFORGE_ALLOW_REMOTE_TEST_URL !== "1") {
    throw new Error("Acceptance mutation requires a local BASE_URL, got " + url.origin);
  }
  if (process.env.NODE_ENV === "production" || process.env.SWARMFORGE_ACCEPTANCE_ENV === "production") {
    throw new Error("Acceptance mutation refuses a production target");
  }
  return value.replace(/\/+$/, "");
}

const input = createInterface({ input: process.stdin });
for await (const line of input) {
  const started = Date.now();
  let id = "unknown";
  try {
    const job = JSON.parse(line) as { id: string; feature_json: string; work_dir: string };
    id = job.id;
    const feature = JSON.parse(await readFile(job.feature_json, "utf8")) as Feature;
    const baseURL = testBaseURL(process.env.BASE_URL ?? "http://127.0.0.1:3000");
    await withMutationLock(job.work_dir, async () => {
      await restorePostgres(baseURL);
      try {
        await runFeature(feature, steps, baseURL);
      } finally {
        await restorePostgres(baseURL);
      }
    });
    process.stdout.write(JSON.stringify({ id, outcome: "test_success", output: "", error: "", duration: (Date.now() - started) * 1_000_000 }) + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(JSON.stringify({ id, outcome: "test_failure", output: "", error: message, duration: (Date.now() - started) * 1_000_000 }) + "\n");
  }
}
