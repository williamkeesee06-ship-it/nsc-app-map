/**
 * Sprint 2.1 — getSchedule (read-only).
 *
 * Returns the week's scheduled events from Smartsheet (Mon–Fri grid).
 * Defaults to "mine" scope (Billy only) and the current week if no weekStart
 * is supplied. The server resolves the current Mon when weekStart is omitted.
 *
 * Use cases (voice):
 *   - "What's on my schedule this week?"
 *   - "What jobs do I have Thursday?"
 *   - "Read me last week's schedule."  (Lumina computes the previous Monday)
 *   - "What's everyone working on this week?"  (scope:"all")
 *
 * Returns a lean projection — workOrder, supervisor, crew, city, address,
 * scheduleDate, endDate, jobStatus, attachmentCount, rowId. Lean enough for
 * the model to summarize aloud without truncation; full row detail is one
 * searchSmartsheetByJob call away.
 *
 * NOTE: This is the same /calendar endpoint the Calendar tab uses, so the
 * server-side cache is shared. Repeat questions stay snappy.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";
import { api, type CalendarEvent } from "../../../lib/api.js";

interface GetScheduleInput {
  /** Monday of the target week in YYYY-MM-DD. Optional — defaults to this Mon. */
  weekStart?: string;
  /** "mine" = Billy only, "all" = every supervisor. Defaults to "mine". */
  scope?: "mine" | "all";
}

interface GetScheduleData {
  scope: "mine" | "all";
  weekStart: string;
  weekEnd: string;
  totalEvents: number;
  /** Events grouped by weekday for easy spoken summary. */
  byDay: Record<string, EventStub[]>;
  events: EventStub[];
}

interface EventStub {
  rowId: number;
  workOrder: string;
  supervisor: string;
  crew: string;
  city: string;
  address: string;
  scheduleDate: string;
  endDate: string;
  jobStatus: string | null;
  attachmentCount: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Compute the Monday of the current week in local time (YYYY-MM-DD). */
function thisMondayLocal(): string {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun, 1=Mon, … 6=Sat
  const daysFromMon = (dow + 6) % 7; // Mon→0, Tue→1, … Sun→6
  const mon = new Date(now);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(mon.getDate() - daysFromMon);
  const y = mon.getFullYear();
  const m = String(mon.getMonth() + 1).padStart(2, "0");
  const d = String(mon.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function projectEvent(e: CalendarEvent): EventStub {
  return {
    rowId: e.rowId,
    workOrder: e.workOrder,
    supervisor: e.supervisor,
    crew: e.crew,
    city: e.city,
    address: e.address,
    scheduleDate: e.scheduleDate,
    endDate: e.endDate,
    jobStatus: e.jobStatus,
    attachmentCount: e.attachmentCount,
  };
}

/** Group events by weekday name (Monday … Friday). Multi-day jobs appear on
 *  each day they span within the week window. */
function bucketByDay(
  events: EventStub[],
  weekStart: string,
  weekEnd: string
): Record<string, EventStub[]> {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const buckets: Record<string, EventStub[]> = {};
  for (const ev of events) {
    // Clamp the event's span to the week window.
    const start = ev.scheduleDate > weekStart ? ev.scheduleDate : weekStart;
    const end = ev.endDate < weekEnd ? ev.endDate : weekEnd;
    if (!start || !end || start > end) continue;
    let cursor = start;
    while (cursor <= end) {
      const [y, m, d] = cursor.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      const name = dayNames[date.getDay()];
      if (!buckets[name]) buckets[name] = [];
      buckets[name].push(ev);
      // Advance one day.
      date.setDate(date.getDate() + 1);
      const ny = date.getFullYear();
      const nm = String(date.getMonth() + 1).padStart(2, "0");
      const nd = String(date.getDate()).padStart(2, "0");
      cursor = `${ny}-${nm}-${nd}`;
    }
  }
  return buckets;
}

async function runGetSchedule(
  input: GetScheduleInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<GetScheduleData>> {
  const scope: "mine" | "all" = input.scope === "all" ? "all" : "mine";
  const weekStart =
    input.weekStart && DATE_RE.test(input.weekStart) ? input.weekStart : thisMondayLocal();

  try {
    const payload = await api.getCalendar(weekStart, scope);
    const events = payload.events.map(projectEvent);
    const byDay = bucketByDay(events, payload.weekStart, payload.weekEnd);

    const lead =
      scope === "mine"
        ? `${payload.totalEvents} job${payload.totalEvents === 1 ? "" : "s"} on Billy's schedule`
        : `${payload.totalEvents} job${payload.totalEvents === 1 ? "" : "s"} across all supervisors`;

    return {
      ok: true,
      message: `${lead} for week of ${payload.weekStart}.`,
      data: {
        scope,
        weekStart: payload.weekStart,
        weekEnd: payload.weekEnd,
        totalEvents: payload.totalEvents,
        byDay,
        events,
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: `getSchedule failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const getScheduleTool: LuminaTool<GetScheduleInput, GetScheduleData> = {
  name: "getSchedule",
  description:
    "Read the week's scheduled jobs from Smartsheet (Mon-Fri grid). Defaults to Billy's scope and the current week. Pass weekStart=YYYY-MM-DD for other weeks; scope='all' for every supervisor. Returns events plus a byDay breakdown for easy spoken summary. Read-only.",
  kind: "read",
  run: runGetSchedule,
};
