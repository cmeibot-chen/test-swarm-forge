import { setPostgresAvailability } from "./postgres.ts";
import { extractVisibleElements, getPageHTML, openPage } from "./page.ts";
import type { ResponseSnapshot, StepDefinition, World } from "./runtime.ts";

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
      const headings = extractVisibleElements(getPageHTML(world), "h1");
      if (headings.length !== 1 || headings[0] !== expected) {
        throw new Error(`Expected one visible h1 with text ${expected}, got ${JSON.stringify(headings)}`);
      }
    },
  },
  {
    pattern: /^the document title is (.+)$/,
    async run(world, _text, [expected = ""]) {
      const titles = extractVisibleElements(getPageHTML(world), "title");
      if (titles.length !== 1 || titles[0] !== expected) {
        throw new Error(`Expected document title ${expected}, got ${JSON.stringify(titles)}`);
      }
    },
  },
  {
    pattern: /^the page has a main landmark$/,
    async run(world) {
      if (!/<main\b[^>]*>/i.test(getPageHTML(world))) throw new Error("Root page has no main landmark");
    },
  },
  {
    pattern: /^no todo entry form or todo list is displayed$/,
    async run(world) {
      const html = getPageHTML(world);
      if (/<form\b/i.test(html) || /todo/i.test(html)) throw new Error("Root page still displays todo-facing UI");
    },
  },
  {
    pattern: /^PostgreSQL is (.+)$/,
    run: async (world, _text, [availability = ""]) => {
      await setPostgresAvailability(world.baseURL, availability);
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
