import { expect, it } from "vitest";
import { MAX_TODO_LENGTH, validateTodoText } from "../lib/todos";

it("trims valid text", () => expect(validateTodoText("  buy milk  ")).toBe("buy milk"));
it("rejects empty text", () => expect(() => validateTodoText("  ")).toThrow("required"));
it("rejects non-string input", () => expect(() => validateTodoText(null)).toThrow("string"));
it("accepts text at the limit", () => expect(validateTodoText("x".repeat(MAX_TODO_LENGTH))).toHaveLength(MAX_TODO_LENGTH));
it("rejects text over the limit", () => expect(() => validateTodoText("x".repeat(MAX_TODO_LENGTH + 1))).toThrow("240"));
