import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_TODO_LENGTH, validateTodoText } from "../lib/todos";

describe("todo text properties", () => {
  it("accepts every non-empty short string after trimming", () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: MAX_TODO_LENGTH }).filter((value) => value.trim().length > 0),
      (value) => {
        const normalized = validateTodoText(value);
        expect(normalized).toBe(value.trim());
        expect(validateTodoText(normalized)).toBe(normalized);
        expect(validateTodoText(` \t\n${value}\r\n `)).toBe(normalized);
      },
    ));
  });

  it("rejects text beyond the limit after trimming", () => {
    fc.assert(fc.property(
      fc.string({ minLength: MAX_TODO_LENGTH + 1, maxLength: MAX_TODO_LENGTH * 4 }),
      (value) => {
        expect(() => validateTodoText(`x${value}x`)).toThrow("characters or fewer");
      },
    ));
  });

  it("rejects non-string values without coercion", () => {
    fc.assert(fc.property(
      fc.anything().filter((value) => typeof value !== "string"),
      (value) => { expect(() => validateTodoText(value)).toThrow("must be a string"); },
    ));
  });

  it("rejects whitespace-only text", () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom(" ", "\t", "\n", "\r", "\u00a0", "\u2003")),
      (characters) => { expect(() => validateTodoText(characters.join(""))).toThrow("required"); },
    ));
  });
});
