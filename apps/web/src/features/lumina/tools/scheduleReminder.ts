/**
 * Tool: scheduleReminder
 *
 * Persist a future reminder that fires a browser notification at the
 * scheduled time. Implementation lives in localStorage + a tiny in-app
 * scheduler that the app initializes on load (see featureflag in
 * luminaStore.tsx). This deliberately does NOT depend on a server cron
 * so it works offline / on flaky cell signal in the field.
 *
 * If Billy wants server-side cross-device reminders later, we can swap
 * the persistence layer for /api/lumina/reminders without changing the
 * tool contract.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface ScheduleReminderInput {
  /** Either an ISO timestamp OR a relative offset like "in 30 minutes". */
  when: string;
  message: string;
  /** Optional jobId to link the reminder back to a specific job. */
  jobId?: string;
}

interface ReminderRecord {
  id: string;
  fireAtMs: number;
  message: string;
  jobId?: string;
  createdAt: number;
}

const STORAGE_KEY = "lumina.reminders.v1";

function readAll(): ReminderRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReminderRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rs: ReminderRecord[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rs));
}

/** Parse "in 30 minutes" / "in 2 hours" / "in 1 day" or an ISO timestamp. */
function parseWhen(when: string): number | null {
  const trimmed = when.trim();
  const m = trimmed.match(/^in\s+(\d+(?:\.\d+)?)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|d)s?$/i);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const ms =
      unit.startsWith("min")
        ? n * 60_000
        : unit.startsWith("h")
        ? n * 3_600_000
        : n * 86_400_000;
    return Date.now() + ms;
  }
  const t = Date.parse(trimmed);
  if (!Number.isNaN(t)) return t;
  return null;
}

async function run(
  input: ScheduleReminderInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<{ id: string; fireAt: string }>> {
  if (!input.when || !input.message) {
    return { ok: false, message: "scheduleReminder requires both when and message." };
  }
  const fireAtMs = parseWhen(input.when);
  if (fireAtMs === null) {
    return {
      ok: false,
      message: `Couldn't parse "${input.when}". Use ISO timestamp or "in N minutes/hours/days".`,
    };
  }
  if (fireAtMs <= Date.now()) {
    return { ok: false, message: "Reminder time is in the past." };
  }
  const id = `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const record: ReminderRecord = {
    id,
    fireAtMs,
    message: input.message,
    jobId: input.jobId,
    createdAt: Date.now(),
  };
  const all = readAll();
  all.push(record);
  writeAll(all);
  // Best-effort: ask for Notification permission so the eventual fire is heard.
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    try {
      void Notification.requestPermission();
    } catch {
      /* ignore */
    }
  }
  const fireAt = new Date(fireAtMs).toISOString();
  return {
    ok: true,
    message: `Reminder set for ${new Date(fireAtMs).toLocaleString()}: "${input.message}".`,
    data: { id, fireAt },
  };
}

export const scheduleReminderTool: LuminaTool<ScheduleReminderInput, { id: string; fireAt: string }> = {
  name: "scheduleReminder",
  description:
    "Schedule a future reminder. 'when' accepts ISO timestamp or 'in N minutes/hours/days'. Fires a browser notification at the scheduled time. Use for 'remind me to call X at 2pm' / 'ping me in 30 minutes'.",
  kind: "read",
  run,
};
