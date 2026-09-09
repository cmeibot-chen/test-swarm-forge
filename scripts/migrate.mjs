import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/todos" });
const client = await pool.connect();
try {
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const id = "001_create_todos";
  const applied = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id]);
  if (applied.rowCount === 0) {
    await client.query("BEGIN");
    await client.query(await readFile(join(process.cwd(), "db/migrations/001_create_todos.sql"), "utf8"));
    await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
    await client.query("COMMIT");
    console.log(`Applied ${id}`);
  } else console.log("Migrations are up to date");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {}); console.error(error); process.exitCode = 1;
} finally { client.release(); await pool.end(); }
