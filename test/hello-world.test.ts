import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import Home from "../app/page";

it("renders one accessible Hello World heading without todo UI", () => {
  const markup = renderToStaticMarkup(createElement(Home));

  expect(markup).toMatch(/<main\b/);
  expect(markup.match(/<h1\b/g)).toHaveLength(1);
  expect(markup).toContain(">Hello World</h1>");
  expect(markup).not.toMatch(/todo/i);
});
