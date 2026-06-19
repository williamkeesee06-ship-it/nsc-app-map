/**
 * Tool: completeTask
 *
 * Mark a task done + hard-delete it via /api/tasks/:id DELETE.
 * Spec: "checked = removed" — so completion is equivalent to deletion.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface CompleteTaskInput {
  taskId: string;
}

interface CompleteTaskData {
  taskId: string;
}

async function run(
  input: CompleteTaskInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<CompleteTaskData>> {
  const taskId = (input.taskId ?? "").trim();
  if (!taskId) {
    return { ok: false, message: "completeTask requires a taskId." };
  }

  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? "";
    } catch { /* ignore */ }
    return {
      ok: false,
      message: `completeTask failed (${res.status}).${detail ? " " + detail : ""}`,
    };
  }

  return {
    ok: true,
    message: `Task completed and removed.`,
    data: { taskId },
  };
}

export const completeTaskTool: LuminaTool<CompleteTaskInput, CompleteTaskData> = {
  name: "completeTask",
  description:
    "Mark a task as done and remove it from Billy's TASKS tab. Use when Billy says a task is finished or asks Lumina to check it off. Per spec, completion = hard delete (no archive).",
  kind: "read",
  run,
};
