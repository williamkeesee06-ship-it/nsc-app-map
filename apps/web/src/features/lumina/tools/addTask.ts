/**
 * Tool: addTask
 *
 * Create a new task in Billy's TASKS tab via /api/tasks POST.
 * source is hardcoded to 'lumina-chat'. ownerName is hardcoded to
 * "Billy Keesee" (the only supervisor scope this app supports today).
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";
import { request } from "../../../lib/api.js";

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

  let j: any;
  try {
    j = await request("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, message: `Failed to create task. ${(err as Error).message}` };
  }

  const t = j.task || j;
  return {
    ok: true,
    message: `Task added: "${t.text.slice(0, 80)}${t.text.length > 80 ? "…" : ""}"`,
    data: { taskId: String(t.id), text: t.text },
  };
}

export const addTaskTool: LuminaTool<AddTaskInput, AddTaskData> = {
  name: "addTask",
  description:
    "Create a new task for Billy in his TASKS tab. Use when Billy asks Lumina to remember, track, or add a to-do item. Text should be a short imperative sentence (max 200 chars). source is always 'lumina-chat' (rendered in royal blue in the UI). Optionally link to a parent task or a job.",
  kind: "read",
  run,
};
