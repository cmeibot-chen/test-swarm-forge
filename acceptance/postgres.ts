import { execFileSync } from "node:child_process";

const HEALTH_WAIT_MS = 60_000;

function composeProject() {
  return process.env.SWARMFORGE_ACCEPTANCE_COMPOSE_PROJECT ?? process.env.COMPOSE_PROJECT_NAME;
}

export function runCompose(args: string[]) {
  const project = composeProject();
  if (!project) {
    throw new Error("PostgreSQL lifecycle requires COMPOSE_PROJECT_NAME or SWARMFORGE_ACCEPTANCE_COMPOSE_PROJECT");
  }
  execFileSync("docker", ["compose", "-p", project, ...args], {
    stdio: ["ignore", "inherit", "inherit"],
  });
}

async function waitForHealth(baseURL: string, expectedStatus: number) {
  const deadline = Date.now() + HEALTH_WAIT_MS;
  let lastStatus = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(2_000) });
      lastStatus = String(response.status);
      if (response.status === expectedStatus) return;
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Health did not reach ${expectedStatus}; last result was ${lastStatus}`);
}

export async function setPostgresAvailability(baseURL: string, availability: string) {
  if (availability === "reachable") {
    runCompose(["start", "db"]);
    await waitForHealth(baseURL, 200);
    return;
  }
  if (availability === "unreachable") {
    runCompose(["stop", "db"]);
    await waitForHealth(baseURL, 503);
    return;
  }
  throw new Error(`Unsupported PostgreSQL availability: ${availability}`);
}

export async function restorePostgres(baseURL: string) {
  if (!composeProject()) return;
  runCompose(["start", "db"]);
  await waitForHealth(baseURL, 200);
}
