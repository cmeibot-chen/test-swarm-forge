import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:http";
import { join } from "node:path";

const root = process.cwd();
const runId = "swarmforge-verify-" + process.pid + "-" + Date.now();
let port = null;
const logDir = join(root, "build/container-verification");
const logFile = join(logDir, runId + ".log");
const reportFile = join(logDir, runId + ".json");
const started = Date.now();
const commands = [];
let source;
let image = "";
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: runId,
  APP_PORT: String(port),
  SWARMFORGE_TEST_RUN_ID: runId,
};
let composeStarted = false;
let passed = false;
let failure;
let serviceLogs = "";

function outputText(value) {
  return String(value ?? "").slice(-20_000);
}

function runCommand(label, command, args, options = {}) {
  const commandStarted = Date.now();
  const text = [command, ...args].join(" ");
  try {
    const output = execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
      ...options,
    });
    commands.push({ label, command: text, exit: 0, duration_ms: Date.now() - commandStarted, output: outputText(output) });
    return output;
  } catch (error) {
    commands.push({
      label,
      command: text,
      exit: error?.status ?? 1,
      duration_ms: Date.now() - commandStarted,
      output: outputText(String(error?.stdout ?? "") + String(error?.stderr ?? "")),
    });
    throw error;
  }
}

const compose = (args, options = {}) =>
  runCommand("docker compose", "docker", ["compose", "-p", runId, ...args], { env, ...options });

function gitOutput(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function gitDirty() {
  try {
    execFileSync("git", ["diff", "--quiet"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: root, stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function recordHttp(label, method, url, commandStarted, status) {
  commands.push({ label, command: method + " " + url, exit: status >= 200 && status < 300 ? 0 : 1, duration_ms: Date.now() - commandStarted, output: "" });
}

try {
  await mkdir(logDir, { recursive: true });
  runCommand("docker daemon", "docker", ["version"], { env });
  runCommand("docker compose version", "docker", ["compose", "version"], { env });
  port = await freePort();
  env.APP_PORT = String(port);

  source = {
    commit: gitOutput("rev-parse", "HEAD"),
    dirty: gitDirty(),
    package_lock_sha256: sha256(join(root, "package-lock.json")),
  };
  if (source.dirty && process.env.SWARMFORGE_REQUIRE_CLEAN === "1") {
    throw new Error("Container verification requires a clean Git worktree; set no override for a reproducible commit run.");
  }

  compose(["up", "-d", "--build"]);
  composeStarted = true;
  await waitFor("http://127.0.0.1:" + port + "/api/health");

  const text = "Docker persistence check";
  await request("POST", "http://127.0.0.1:" + port + "/api/todos", { text });
  const e2eEnv = { ...env, BASE_URL: "http://127.0.0.1:" + port, E2E_TODO: "Docker browser check" };
  runCommand("browser e2e", "npm", ["run", "test:e2e"], { env: e2eEnv });

  compose(["up", "-d", "--build", "--no-deps", "app"]);
  await waitFor("http://127.0.0.1:" + port + "/api/health");
  const todos = await request("GET", "http://127.0.0.1:" + port + "/api/todos");
  if (!todos.todos?.some((todo) => todo.text === text) ||
      !todos.todos?.some((todo) => todo.text === "Docker browser check")) {
    throw new Error("Todo did not survive the app-only rebuild");
  }
  image = compose(["images", "-q", "app"]).trim();
  passed = true;
  console.log("Container verification passed for " + source.commit + "; logs: " + logFile);
  const report = {
    result: "passed",
    run_id: runId,
    source,
    toolchain: {
      node: runCommand("node version", "node", ["--version"]),
      npm: runCommand("npm version", "npm", ["--version"]),
      compose: runCommand("compose version", "docker", ["compose", "version"]),
    },
    host: { platform: process.platform, arch: process.arch, release: os.release() },
    image,
    compose_project: runId,
    volume: runId + "_todos-db",
    app_port: port,
    scope: ["compose build", "PostgreSQL migration/health", "browser e2e", "app-only rebuild", "PostgreSQL persistence"],
    commands,
    duration_ms: Date.now() - started,
  };
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
  console.error("Container verification failed; logs: " + logFile + "\n" + failure);
} finally {
  if (composeStarted) {
    if (!image) {
      try { image = compose(["images", "-q", "app"]).trim(); } catch {}
    }
    try {
      serviceLogs = compose(["logs", "--no-color"]);
    } catch (error) {
      serviceLogs = String(error);
    }
    try {
      compose(["down", "--volumes", "--remove-orphans"]);
    } catch (error) {
      const cleanup = error instanceof Error ? error.message : String(error);
      if (!failure) {
        failure = "Container cleanup failed: " + cleanup;
        process.exitCode = 1;
      }
    }
  }
  await mkdir(logDir, { recursive: true });
  const report = {
    result: passed ? "passed" : "failed",
    run_id: runId,
    source: { commit: safeGitHead(), dirty: gitDirty(), package_lock_sha256: safeHash() },
    host: { platform: process.platform, arch: process.arch, release: os.release() },
    toolchain: toolchainReport(),
    image,
    compose_project: runId,
    volume: runId + "_todos-db",
    app_port: port,
    scope: ["compose build", "PostgreSQL migration/health", "browser e2e", "app-only rebuild", "PostgreSQL persistence"],
    commands,
    duration_ms: Date.now() - started,
    error: failure ?? null,
  };
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  await writeFile(logFile, JSON.stringify(report, null, 2) + "\n\n" + outputText(serviceLogs));
}

function toolchainReport() {
  return {
    node: safeCommand("node", ["--version"]),
    npm: safeCommand("npm", ["--version"]),
    compose: safeCommand("docker", ["compose", "version"]),
  };
}

function safeCommand(command, args) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function safeGitHead() {
  try { return gitOutput("rev-parse", "HEAD"); } catch { return ""; }
}

function safeHash() {
  try { return sha256(join(root, "package-lock.json")); } catch { return ""; }
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for " + url);
}

async function request(method, url, body) {
  const commandStarted = Date.now();
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  recordHttp("HTTP " + method, method, url, commandStarted, response.status);
  const payload = await response.json();
  if (!response.ok) throw new Error(url + " returned " + response.status + ": " + JSON.stringify(payload));
  return payload;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}
