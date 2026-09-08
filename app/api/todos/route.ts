import { NextResponse } from "next/server";
import { insertTodo, listTodos, pool } from "../../../lib/db";
import { validateTodoText } from "../../../lib/todos";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json({ todos: await listTodos() }); }
  catch { return NextResponse.json({ error: "Could not load todos" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const value = typeof body === "object" && body !== null && "text" in body ? (body as { text?: unknown }).text : undefined;
    return NextResponse.json({ todo: await insertTodo(validateTodoText(value)) }, { status: 201 });
  } catch (reason: unknown) {
    const message = reason instanceof Error ? reason.message : "Invalid todo";
    return NextResponse.json({ error: message }, { status: message.startsWith("Todo text") ? 400 : 503 });
  }
}

export async function DELETE(request: Request) {
  if (process.env.NODE_ENV === "production" || request.headers.get("x-swarmforge-test-reset") !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await pool.query("TRUNCATE todos RESTART IDENTITY");
  return NextResponse.json({ ok: true });
}
