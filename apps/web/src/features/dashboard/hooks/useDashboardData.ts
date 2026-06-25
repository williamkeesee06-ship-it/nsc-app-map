// Single dashboard data hook.
//
// Architecture note (spec said `onSnapshot`): this web app has NO client-side
// Firestore SDK — all reads go through the same-origin REST API (api.listJobs,
// api.getCalendar). We therefore follow the app's established pattern (see
// useJobs.ts): consume the already-live `jobs` array (kept fresh by useJobs via
// the nsc:jobs-reload bus) for job-derived data, fetch the crew calendar once
// per week, and refetch on window focus. This matches the codebase rather than
// introducing a second data path.

import { useEffect, useMemo, useState } from "react";
import type { Job } from "@nsc/types";
import { api, type CalendarEvent } from "../../../lib/api.js";
import { isJobCompleted } from "../../jobs-map/markerStyle.js";
import { countByStatus, type StatusCounts } from "../dashboardStatus.js";

export interface CrewEntry {
  name: string;
  jobId: string;
  address: string;
}

export type WeekSchedule = Record<string, { crews: CrewEntry[] }>;

export type RiskLevel = "HIGH" | "MED";

export interface AtRiskJob {
  job: Job;
  risk: RiskLevel;
  reason: string;
  dueDate: string | null;
}

export interface ActivityRow {
  jobId: string;
  workOrder: string;
  status: string;
  at: number;
}

export interface DashboardData {
  statusCounts: StatusCounts;
  myJobs: Job[];
  atRiskJobs: AtRiskJob[];
  weekSchedule: WeekSchedule;
  recentActivity: ActivityRow[];
  weekStart: string;
  loadingCalendar: boolean;
}

const DAY_MS = 86_400_000;

// Monday of the current week as YYYY-MM-DD (Pacific-agnostic local date).
function mondayOfThisWeek(now: Date = new Date()): string {
  const d = new Date(now);
  const dow = d.getDay(); // 0 = Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return toIso(d);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.slice(0, 10));
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / DAY_MS);
}

function needsPermit(job: Job): boolean {
  const p = (job.permitRequired ?? "").trim();
  return /^(y|yes|true|required|1)/i.test(p);
}

// Derive at-risk jobs from live fields. NOTE: there is no permit-expiration or
// submission-date field in the Job schema, so:
//  - "permit expiring ≤7 days" is approximated as permit-required jobs
//    scheduled within 7 days (closest live signal).
//  - "submitted >7 days, no approval" cannot be computed (no submission date)
//    and is intentionally omitted rather than guessed.
function computeAtRisk(jobs: Job[]): AtRiskJob[] {
  const out: AtRiskJob[] = [];
  for (const job of jobs) {
    if (isJobCompleted(job)) continue;
    const d = daysUntil(job.scheduleDate);

    if (d !== null && d < 0) {
      out.push({
        job,
        risk: "HIGH",
        reason: "Schedule date passed, not completed",
        dueDate: job.scheduleDate,
      });
      continue;
    }
    if (needsPermit(job) && d !== null && d >= 0 && d <= 7) {
      out.push({
        job,
        risk: "MED",
        reason: "Permit required, scheduled within 7 days",
        dueDate: job.scheduleDate,
      });
    }
  }
  // HIGH first, then soonest due date.
  out.sort((a, b) => {
    if (a.risk !== b.risk) return a.risk === "HIGH" ? -1 : 1;
    return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
  });
  return out;
}

function buildWeekSchedule(events: CalendarEvent[]): WeekSchedule {
  const out: WeekSchedule = {};
  for (const ev of events) {
    const date = (ev.scheduleDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const crewName = (ev.crew ?? "").trim() || "(unassigned)";
    const bucket = out[date] ?? { crews: [] };
    // Dedupe by crew name within a day (multiple jobs → keep first job ref).
    if (!bucket.crews.some((c) => c.name === crewName)) {
      bucket.crews.push({
        name: crewName,
        jobId: ev.workOrder || String(ev.rowId),
        address: [ev.address, ev.city].filter(Boolean).join(", "),
      });
    }
    out[date] = bucket;
  }
  return out;
}

export function useDashboardData(jobs: Job[]): DashboardData {
  const weekStart = useMemo(() => mondayOfThisWeek(), []);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [nonce, setNonce] = useState(0);

  // Fetch the crew calendar for the current week; refetch on window focus so
  // the rollup stays current without a websocket/snapshot listener.
  useEffect(() => {
    let cancelled = false;
    setLoadingCalendar(true);
    api
      .getCalendar(weekStart, "mine")
      .then((payload) => {
        if (!cancelled) setEvents(payload.events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingCalendar(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, nonce]);

  useEffect(() => {
    function onFocus() {
      setNonce((n) => n + 1);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const statusCounts = useMemo(() => countByStatus(jobs), [jobs]);
  const atRiskJobs = useMemo(() => computeAtRisk(jobs), [jobs]);
  const weekSchedule = useMemo(() => buildWeekSchedule(events), [events]);
  const recentActivity = useMemo<ActivityRow[]>(() => {
    return [...jobs]
      .sort((a, b) => (b.lastSyncedAt ?? 0) - (a.lastSyncedAt ?? 0))
      .slice(0, 6)
      .map((j) => ({
        jobId: j.jobId,
        workOrder: j.workOrder,
        status: j.secondaryJobStatus ?? j.jobStatus ?? "",
        at: j.lastSyncedAt ?? 0,
      }));
  }, [jobs]);

  return {
    statusCounts,
    myJobs: jobs,
    atRiskJobs,
    weekSchedule,
    recentActivity,
    weekStart,
    loadingCalendar,
  };
}
