import { expect, it } from "vitest";
import { runFeature, type Feature } from "../acceptance/runtime";

it("passes scenario-outline values to regex step handlers", async () => {
  let captured = "";
  const feature: Feature = {
    name: "capture",
    scenarios: [{
      name: "example",
      steps: [{ keyword: "Then", text: "the value is <expected>" }],
      examples: [{ expected: "Hello World" }],
    }],
  };

  await runFeature(feature, [{
    pattern: /^the value is (.+)$/,
    async run(_world, _text, [value]) {
      captured = value;
    },
  }], "http://127.0.0.1:3000");

  expect(captured).toBe("Hello World");
});
