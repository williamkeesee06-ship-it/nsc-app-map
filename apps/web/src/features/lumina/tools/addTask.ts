/**
 * Tool: addTask
 *
 * Create a new task in Billy's TASKS tab via /api/tasks POST.
 * source is hardcoded to 'lumina-chat'. ownerName is hardcoded to
 * "Billy Keesee" (the only supervisor scope this app supports today).
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface AddTaskInput {
  text: string;
  parentId?: string;
  jobRef?: { id: string; label: string };
}

interface AddTaskData {
  taskId: string;
  text: string;
}

async function run(
  input: AddTaskInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<AddTaskData>> {
  const text = (input.text ?? "").trim();
  if (!text) {
    return { ok: false, message: "addTask requires non-empty text." };
  }
  if (text.length > 200) {
    return { ok: false, message: "Task text too long (max 200 chars)." };
  }

  const payload: Record<string, unknown> = {
    ownerName: "Billy Keesee",
    text,
    source: "lumina-chat",
  };
  if (input.parentId) payload.parentId = input.parentId;
  if (input.jobRef?.id && input.jobRef?.label) payload.jobRef = input.jobRef;

  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? "";
    } catch { /* ignore */ }
    return {
      ok: false,
      message: `addTask failed (${res.status}).${detail ? " " + detail : ""}`,
    };
  }

  const body = (await res.json()) as { task: { id: string; text: string } };
  return {
    ok: true,
    message: `Task added: "${body.task.text.slice(0, 80)}${body.task.text.length > 80 ? "…" : ""}"`,
    data: { taskId: body.task.id, text: body.task.text },
  };
}

export const addTaskTool: LuminaTool<AddTaskInput, AddTaskData> = {
  name: "addTask",
  description:
    "Create a new task for Billy in his TASKS tab. Use when Billy asks Lumina to remember, track, or add a to-do item. Text should be a short imperative sentence (max 200 chars). source is always 'lumina-chat' (rendered in royal blue in the UI). Optionally link to a parent task or a job.",
  kind: "read",
  run,
};
