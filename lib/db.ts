import { Pool } from "pg";
import type { Todo } from "./todos";

const connectionString = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/todos";
const globalForDatabase = globalThis as typeof globalThis & { todoPool?: Pool };
export const pool = globalForDatabase.todoPool ?? new Pool({
  connectionString,
  max: 10,
  connectionTimeoutMillis: 1_000,
  query_timeout: 2_000,
});
if (process.env.NODE_ENV !== "production") globalForDatabase.todoPool = pool;

export async function listTodos(): Promise<Todo[]> {
  const result = await pool.query<{ id: string; text: string; created_at: Date }>(
    "SELECT id, text, created_at FROM todos ORDER BY created_at DESC, id DESC",
  );
  return result.rows.map((row) => ({ id: Number(row.id), text: row.text, createdAt: row.created_at.toISOString() }));
}

export async function insertTodo(text: string): Promise<Todo> {
  const result = await pool.query<{ id: string; text: string; created_at: Date }>(
    "INSERT INTO todos (text) VALUES ($1) RETURNING id, text, created_at", [text],
  );
  const row = result.rows[0];
  return { id: Number(row.id), text: row.text, createdAt: row.created_at.toISOString() };
}
