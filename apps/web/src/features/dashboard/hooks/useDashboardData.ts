// Single dashboard data hook. Everything is derived synchronously from the
// already-live `jobs` array (kept fresh by useJobs via the nsc:jobs-reload
// bus) using the real Job schema — no invented fields, no second data path.

import { useMemo } from "react";
import type { Job } from "@nsc/types";
import { bucketForJob } from "../../jobs-map/markerStyle.js";
import { countByBucket, type BucketCounts } from "../dashboardStatus.js";

export interface CrewEntry {
  /** constructionCrewForeman, or "Unassigned" when blank. */
  name: string;
  /** workOrder — the operator-facing job id. */
  jobId: string;
  address: string;
}

export interface DaySchedule {
  /** Rows for the day, deduped by (foreman, workOrder). */
  crews: CrewEntry[];
  /** Distinct foreman count — the "crews today" badge. */
  crewCount: number;
}

export type WeekSchedule = Record<string, DaySchedule>;

export type RiskLevel = "HIGH" | "MED";

export interface AtRiskJob {
  job: Job;
  risk: RiskLevel;
  reason: string;
  dueDate: string | null;
}

export interface DashboardData {
  statusCounts: BucketCounts;
  myJobs: Job[];
  atRiskJobs: AtRiskJob[];
  weekSchedule: WeekSchedule;
  weekStart: string;
}

const DAY_MS = 86_400_000;

// Monday of the current week as YYYY-MM-DD (local date).
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

function todayIso(): string {
  return toIso(new Date());
}

// Whole-day delta from today to an ISO date (negative = in the past).
function daysFromToday(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.slice(0, 10));
  if (Number.isNaN(t)) return null;
  const today = Date.parse(todayIso());
  return Math.round((t - today) / DAY_MS);
}

function isEmpty(value: string | null | undefined): boolean {
  return !value || !value.trim();
}

function isTruthyFlag(value: string | null | undefined): boolean {
  return /^(y|yes|true|required|1)/i.test((value ?? "").trim());
}

// Days since an ISO timestamp (e.g. smartsheetModified). null if unparseable.
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.round((Date.now() - t) / DAY_MS);
}

// At-risk rules, all from real fields (see dashboard_fix_spec §2). NOTE: the
// "no recent crew change" qualifier on the traffic-control rule has no backing
// field in the Job schema, so it is omitted (reported, not guessed).
function computeAtRisk(jobs: Job[]): AtRiskJob[] {
  const out: AtRiskJob[] = [];
  for (const job of jobs) {
    const bucket = bucketForJob(job);
    if (bucket === "completed") continue;

    const sched = daysFromToday(job.scheduleDate);
    const noCompletion = isEmpty(job.actualCompletionDate);

    // Schedule slip — past schedule date, not completed.
    if (sched !== null && sched < 0 && noCompletion) {
      out.push({
        job,
        risk: sched < -7 ? "HIGH" : "MED",
        reason:
          sched < -7
            ? `Schedule slip — ${-sched} days past, not completed`
            : "Schedule slip — past schedule date, not completed",
        dueDate: job.scheduleDate,
      });
      continue;
    }

    // Permit pending — permit required, scheduled within the next 7 days.
    if (isTruthyFlag(job.permitRequired) && sched !== null && sched >= 0 && sched <= 7) {
      out.push({
        job,
        risk: "MED",
        reason: "Permit pending — permit required, scheduled within 7 days",
        dueDate: job.scheduleDate,
      });
      continue;
    }

    // Traffic control needed soon — scheduled within the next 3 days.
    if (job.trafficControlRequired === true && sched !== null && sched >= 0 && sched <= 3) {
      out.push({
        job,
        risk: "MED",
        reason: "Traffic control needed soon — scheduled within 3 days",
        dueDate: job.scheduleDate,
      });
      continue;
    }

    // Stale hold — on hold for more than 14 days.
    if (bucket === "on_hold") {
      const held = daysSince(job.smartsheetModified);
      if (held !== null && held > 14) {
        out.push({
          job,
          risk: "MED",
          reason: `Stale hold — on hold ${held} days`,
          dueDate: job.scheduleDate,
        });
      }
    }
  }

  // HIGH first, then soonest schedule date.
  out.sort((a, b) => {
    if (a.risk !== b.risk) return a.risk === "HIGH" ? -1 : 1;
    return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
  });
  return out;
}

// Group the current week's jobs by scheduleDate, then by foreman. The badge is
// the distinct-foreman count; rows are deduped by (foreman, workOrder); blank
// foreman groups under "Unassigned".
function buildWeekSchedule(jobs: Job[], weekStart: string): WeekSchedule {
  const weekDays = new Set<string>();
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(`${weekStart}T00:00:00`);
    d.setDate(d.getDate() + i);
    weekDays.add(toIso(d));
  }

  const out: WeekSchedule = {};
  const seen = new Map<string, Set<string>>(); // date -> set of "foreman||workOrder"
  const foremen = new Map<string, Set<string>>(); // date -> set of foreman

  for (const job of jobs) {
    const date = (job.scheduleDate ?? "").slice(0, 10);
    if (!weekDays.has(date)) continue;

    const foreman = (job.constructionCrewForeman ?? "").trim() || "Unassigned";
    const wo = job.workOrder || job.jobId;
    const dedupeKey = `${foreman}||${wo}`;

    const seenForDay = seen.get(date) ?? new Set<string>();
    if (seenForDay.has(dedupeKey)) continue;
    seenForDay.add(dedupeKey);
    seen.set(date, seenForDay);

    const foremenForDay = foremen.get(date) ?? new Set<string>();
    foremenForDay.add(foreman);
    foremen.set(date, foremenForDay);

    const bucket = out[date] ?? { crews: [], crewCount: 0 };
    bucket.crews.push({
      name: foreman,
      jobId: wo,
      address: [job.address, job.city].filter(Boolean).join(", "),
    });
    out[date] = bucket;
  }

  for (const [date, set] of foremen) {
    if (out[date]) out[date].crewCount = set.size;
  }
  return out;
}

export function useDashboardData(jobs: Job[]): DashboardData {
  const weekStart = useMemo(() => mondayOfThisWeek(), []);
  const statusCounts = useMemo(() => countByBucket(jobs), [jobs]);
  const atRiskJobs = useMemo(() => computeAtRisk(jobs), [jobs]);
  const weekSchedule = useMemo(
    () => buildWeekSchedule(jobs, weekStart),
    [jobs, weekStart]
  );

  return {
    statusCounts,
    myJobs: jobs,
    atRiskJobs,
    weekSchedule,
    weekStart,
  };
}
