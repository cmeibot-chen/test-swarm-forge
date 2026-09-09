import { execFileSync } from "node:child_process";
import type { ResponseSnapshot, StepDefinition, World } from "./runtime.ts";

const healthWaitMs = 60_000;

function composeProject() {
  return process.env.SWARMFORGE_ACCEPTANCE_COMPOSE_PROJECT ?? process.env.COMPOSE_PROJECT_NAME;
}

function runCompose(args: string[]) {
  const project = composeProject();
  if (!project) {
    throw new Error("PostgreSQL lifecycle requires COMPOSE_PROJECT_NAME or SWARMFORGE_ACCEPTANCE_COMPOSE_PROJECT");
  }
  execFileSync("docker", ["compose", "-p", project, ...args], { stdio: "inherit" });
}

async function waitForHealth(world: World, expectedStatus: number) {
  const deadline = Date.now() + healthWaitMs;
  let lastStatus = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${world.baseURL}/api/health`, { signal: AbortSignal.timeout(2_000) });
      lastStatus = String(response.status);
      if (response.status === expectedStatus) return;
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Health did not reach ${expectedStatus}; last result was ${lastStatus}`);
}

async function setPostgresAvailability(world: World, availability: string) {
  if (availability === "reachable") {
    runCompose(["start", "db"]);
    await waitForHealth(world, 200);
    return;
  }
  if (availability === "unreachable") {
    runCompose(["stop", "db"]);
    await waitForHealth(world, 503);
    return;
  }
  throw new Error(`Unsupported PostgreSQL availability: ${availability}`);
}

export async function restorePostgres(baseURL: string) {
  if (!composeProject()) return;
  const world: World = { baseURL };
  runCompose(["start", "db"]);
  await waitForHealth(world, 200);
}

function page(world: World) {
  if (world.pageHTML === undefined) throw new Error("Open the root page before asserting page content");
  return world.pageHTML;
}

function textContent(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function visibleElements(html: string, tag: string) {
  const elements: string[] = [];
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] ?? "";
    if (/\bhidden\b/i.test(attributes) || /aria-hidden\s*=\s*["']true["']/i.test(attributes)) continue;
    if (/style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes)) continue;
    elements.push(textContent(match[2] ?? ""));
  }
  return elements;
}

async function openPage(world: World) {
  const response = await fetch(`${world.baseURL}/`, { signal: AbortSignal.timeout(5_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Root page failed: ${response.status}`);
  world.pageHTML = body;
}

export const steps: StepDefinition[] = [
  {
    pattern: /^the application is running$/,
    async run(world) {
      const response = await fetch(`${world.baseURL}/`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`Application is unavailable: ${response.status}`);
    },
  },
  {
    pattern: /^I open the root page$/,
    run: openPage,
  },
  {
    pattern: /^the page has one visible level-one heading with exact text (.+)$/,
    async run(world, _text, [expected = ""]) {
      const headings = visibleElements(page(world), "h1");
      if (headings.length !== 1 || headings[0] !== expected) {
        throw new Error(`Expected one visible h1 with text ${expected}, got ${JSON.stringify(headings)}`);
      }
    },
  },
  {
    pattern: /^the document title is (.+)$/,
    async run(world, _text, [expected = ""]) {
      const titles = visibleElements(page(world), "title");
      if (titles.length !== 1 || titles[0] !== expected) {
        throw new Error(`Expected document title ${expected}, got ${JSON.stringify(titles)}`);
      }
    },
  },
  {
    pattern: /^the page has a main landmark$/,
    async run(world) {
      if (!/<main\b[^>]*>/i.test(page(world))) throw new Error("Root page has no main landmark");
    },
  },
  {
    pattern: /^no todo entry form or todo list is displayed$/,
    async run(world) {
      const html = page(world);
      if (/<form\b/i.test(html) || /todo/i.test(html)) throw new Error("Root page still displays todo-facing UI");
    },
  },
  {
    pattern: /^PostgreSQL is (.+)$/,
    run: async (world, _text, [availability = ""]) => {
      await setPostgresAvailability(world, availability);
    },
  },
  {
    pattern: /^I send GET to (\S+)$/,
    async run(world, _text, [path = "/"]) {
      const response = await fetch(new URL(path, `${world.baseURL}/`), { signal: AbortSignal.timeout(5_000) });
      const body = await response.text();
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        json = undefined;
      }
      const snapshot: ResponseSnapshot = { status: response.status, body, json };
      world.response = snapshot;
    },
  },
  {
    pattern: /^the HTTP response code is (\d+)$/,
    async run(world, _text, [expectedCode = ""]) {
      const expected = Number(expectedCode);
      if (world.response?.status !== expected) {
        throw new Error(`Expected HTTP ${expected}, got ${world.response?.status ?? "no response"}`);
      }
    },
  },
  {
    pattern: /^the JSON response has status (.+)$/,
    async run(world, _text, [expected = ""]) {
      const actual = world.response?.json;
      if (typeof actual !== "object" || actual === null || !("status" in actual) || actual.status !== expected) {
        throw new Error(`Expected JSON status ${expected}, got ${JSON.stringify(actual)}`);
      }
    },
  },
];
