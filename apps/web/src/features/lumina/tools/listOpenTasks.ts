/**
 * Tool: listOpenTasks
 *
 * Return Billy's current open tasks (done=false) so Lumina can reference
 * them in conversation — e.g. "what's on my list", or before adding a new
 * task to avoid duplicates.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

import { request } from "../../../lib/api.js";

// Use a permissive type for what we expose to the model — the full Task
// shape lives server-side, but Lumina only needs id/text/source/parent.
interface TaskSummary {
  id: string;
  text: string;
  source: "user" | "lumina-chat" | "lumina-email";
  parentId: string | null;
  createdAt: number;
}

interface ListOpenTasksData {
  tasks: TaskSummary[];
}

async function run(
  _input: Record<string, unknown>,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<ListOpenTasksData>> {
  let body: { tasks: Array<Record<string, unknown>> };
  try {
    body = await request<{ tasks: Array<Record<string, unknown>> }>(
      `/api/tasks?owner=${encodeURIComponent("Billy Keesee")}`
    );
  } catch (err) {
    return {
      ok: false,
      message: `listOpenTasks failed. ${(err as Error).message}`,
    };
  }

  const tasks: TaskSummary[] = (body.tasks ?? []).map((t) => ({
    id: String(t.id ?? ""),
    text: String(t.text ?? ""),
    source: (t.source as TaskSummary["source"]) ?? "user",
    parentId: (t.parentId as string | null) ?? null,
    createdAt: Number(t.createdAt ?? 0),
  }));

  return {
    ok: true,
    message: `${tasks.length} open task${tasks.length === 1 ? "" : "s"}.`,
    data: { tasks },
  };
}

export const listOpenTasksTool: LuminaTool<Record<string, unknown>, ListOpenTasksData> = {
  name: "listOpenTasks",
  description:
    "List Billy's open (uncompleted) tasks from the TASKS tab. Use when Billy asks 'what are my tasks' / 'what's on my list', or before adding a task so you can avoid creating a duplicate. Returns id, text, source, parentId, createdAt for each open task.",
  kind: "read",
  run,
};
