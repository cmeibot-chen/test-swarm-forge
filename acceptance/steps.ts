import type { StepDefinition } from "./runtime.ts";

export const steps: StepDefinition[] = [
  {
    pattern: /^the todo app is available$/,
    async run(world) {
      const response = await fetch(`${world.baseURL}/api/health`);
      if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
    },
  },
  {
    pattern: /^I add a todo named (.+)$/,
    async run(world, text) {
      const todo = text.replace(/^I add a todo named /, "");
      const response = await fetch(`${world.baseURL}/api/todos`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: todo }),
      });
      if (!response.ok) throw new Error(`Create todo failed: ${response.status}`);
      world.lastTodo = todo;
    },
  },
  {
    pattern: /^I see (.+) in the todo list$/,
    async run(world, text) {
      const expected = text.replace(/^I see (.+) in the todo list$/, "$1");
      const response = await fetch(`${world.baseURL}/api/todos`);
      const payload = (await response.json()) as { todos?: { text: string }[] };
      if (!response.ok || !payload.todos?.some((todo) => todo.text === expected)) throw new Error(`Todo was not listed: ${expected}`);
    },
  },
];
