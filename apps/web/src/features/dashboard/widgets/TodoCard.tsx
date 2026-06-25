// My Todo List — reads the same Firestore-backed /api/tasks list as the
// full Tasks tab (Todoist/Reminders pattern). Shows the top open tasks with a
// priority badge and a neon "+" inline composer that adds a user task.
//
// Priority: the Task schema has no priority field, so we derive it from the
// task `source` — lumina-email = HIGH, lumina-chat = MED, user = LOW. This is
// a defensible proxy (email-sourced action items are the most time-sensitive);
// flagged for Billy in case a real priority field is wanted.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/authContext.js";

type TaskSource = "user" | "lumina-chat" | "lumina-email";

interface Task {
  id: string;
  text: string;
  done: boolean;
  parentId: string | null;
  orderIndex: number;
  source: TaskSource;
  createdAt: number;
}

type Priority = "HIGH" | "MED" | "LOW";

const MAX_ROWS = 5;
const DEFAULT_OWNER = "Billy Keesee";

function priorityOf(source: TaskSource): Priority {
  if (source === "lumina-email") return "HIGH";
  if (source === "lumina-chat") return "MED";
  return "LOW";
}

// Tasks store rich text (tiptap HTML). Render as plain text in this compact
// card to avoid injecting markup.
function toPlainText(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent ?? "").trim();
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) throw new Error(`tasks ${r.status}`);
  return r.json() as Promise<T>;
}

export default function TodoCard() {
  const { username } = useAuth();
  const owner = username ?? DEFAULT_OWNER;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ tasks: Task[] }>(`/api/tasks?owner=${encodeURIComponent(owner)}`)
      .then((payload) => {
        if (!cancelled) setTasks(payload.tasks.filter((t) => t.parentId === null));
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner]);

  useEffect(() => reload(), [reload]);

  const visible = useMemo(() => tasks.slice(0, MAX_ROWS), [tasks]);

  const addTask = useCallback(async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await apiFetch<{ task: Task }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ ownerName: owner, text, source: "user" }),
      });
      setDraft("");
      reload();
    } catch {
      // keep the draft so the user can retry
    } finally {
      setSaving(false);
    }
  }, [draft, owner, reload, saving]);

  return (
    <div className="card card--light todo-card">
      <div className="card__header">
        <h2 className="card__title">My Todo List</h2>
      </div>

      <div className="todo-card__composer">
        <button
          type="button"
          className="todo-card__add"
          aria-label="Add task"
          onClick={addTask}
          disabled={saving || !draft.trim()}
        >
          +
        </button>
        <input
          className="todo-card__input"
          type="text"
          value={draft}
          placeholder="Add a task…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addTask();
          }}
        />
      </div>

      {loading ? (
        <div className="dash-skel dash-skel--list" aria-hidden />
      ) : visible.length === 0 ? (
        <p className="todo-card__empty">Nothing on your list. Nice.</p>
      ) : (
        <ul className="todo-card__list">
          {visible.map((t) => {
            const priority = priorityOf(t.source);
            return (
              <li className="todo-card__item" key={t.id}>
                <span
                  className={`todo-card__badge todo-card__badge--${priority.toLowerCase()}`}
                >
                  {priority}
                </span>
                <span className="todo-card__text">{toPlainText(t.text)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
