import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateTodoText } from "../lib/todos";

describe("todo text properties", () => {
  it("accepts every non-empty short string after trimming", () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 20 }).filter((value) => value.trim().length > 0),
      (value) => { expect(validateTodoText(value)).toBe(value.trim()); },
    ));
  });
});
