"use client";

import { useEffect, useState, type FormEvent } from "react";
type Todo = { id: number; text: string; createdAt: string };

export default function Home() {
  const [text, setText] = useState("");
  const [todos, setTodos] = useState<Todo[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/todos", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load todos");
        return (await response.json()) as { todos: Todo[] };
      })
      .then((payload) => { if (active) setTodos(payload.todos); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load todos");
      });
    return () => { active = false; };
  }, []);

  async function addTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/todos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const payload = (await response.json()) as { todo?: Todo; error?: string };
      if (!response.ok || !payload.todo) throw new Error(payload.error ?? "Could not add todo");
      setTodos((current) => [payload.todo as Todo, ...current]); setText("");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not add todo");
    } finally { setSaving(false); }
  }

  return <main className="mx-auto min-h-screen max-w-2xl px-6 py-16">
    <section className="rounded-3xl bg-white p-8 shadow-xl shadow-slate-200/60">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">SwarmForge</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">Todo list</h1>
      <p className="mt-3 text-slate-600">Add a task and it will still be here after the app restarts.</p>
      <form className="mt-8 flex gap-3" onSubmit={addTodo}>
        <label className="sr-only" htmlFor="new-todo">New todo</label>
        <input id="new-todo" value={text} onChange={(event) => setText(event.target.value)} placeholder="What needs doing?" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
        <button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60">{saving ? "Adding…" : "Add todo"}</button>
      </form>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      <h2 className="mt-10 text-xl font-semibold">Your todos</h2>
      {todos.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-slate-500">No todos yet.</p> : <ul className="mt-4 space-y-3" aria-label="Todo list">{todos.map((todo) => <li key={todo.id} className="rounded-xl bg-slate-50 px-4 py-3">{todo.text}</li>)}</ul>}
    </section>
  </main>;
}
