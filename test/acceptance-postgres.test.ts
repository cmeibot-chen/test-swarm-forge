import { expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
const { runCompose } = await import("../acceptance/postgres");

it("keeps the PostgreSQL lifecycle adapter off the runner protocol stdout", () => {
  const previousProject = process.env.COMPOSE_PROJECT_NAME;
  try {
    process.env.COMPOSE_PROJECT_NAME = "acceptance-test";
    runCompose(["start", "db"]);

    expect(execFileSync).toHaveBeenCalledWith(
      "docker",
      ["compose", "-p", "acceptance-test", "start", "db"],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
  } finally {
    if (previousProject === undefined) delete process.env.COMPOSE_PROJECT_NAME;
    else process.env.COMPOSE_PROJECT_NAME = previousProject;
  }
});
