export const MAX_TODO_LENGTH = 240;

export function validateTodoText(value: unknown): string {
  if (typeof value !== "string") throw new Error("Todo text must be a string");
  const text = value.trim();
  if (!text) throw new Error("Todo text is required");
  if (text.length > MAX_TODO_LENGTH) throw new Error(`Todo text must be ${MAX_TODO_LENGTH} characters or fewer`);
  return text;
}
