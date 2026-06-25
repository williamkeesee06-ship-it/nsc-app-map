// Dashboard hero status segments.
//
// IMPORTANT (schema reality vs. spec): the build spec lists six segments —
// PENDING / SCHEDULED / IN PROGRESS / READY / SUBMITTED / APPROVED — in a fixed
// order and color. The live Smartsheet `secondaryJobStatus` picklist does NOT
// use those exact labels (it uses Pending / Scheduled / Routed to Sub / Pending
// Splicing / RTS / Fielded - RTS / Needs Fielding / On Hold / Complete, etc. —
// see markerStyle.ts). We therefore render the spec's six segments verbatim and
// match each against the real status strings with the closest defensible rule.
// "SUBMITTED" has no corresponding source value, so it will read 0 until the
// sheet gains a "Submitted" status. Each segment also maps to the nearest real
// filter bucket so tapping a segment can pre-filter the map.

import type { StatusBucket } from "../jobs-map/markerStyle.js";
import { isJobCompleted } from "../jobs-map/markerStyle.js";
import type { Job } from "@nsc/types";

export type DashboardSegmentKey =
  | "pending"
  | "scheduled"
  | "in_progress"
  | "ready"
  | "submitted"
  | "approved";

export interface DashboardSegment {
  key: DashboardSegmentKey;
  label: string;
  /** CSS custom property name for the neon color. */
  colorVar: string;
  /** Nearest real filter bucket for tap-to-filter navigation (null = no map filter). */
  bucket: StatusBucket | null;
  /** Match a lowercased, trimmed secondaryJobStatus to this segment. */
  match: (status: string, job: Job) => boolean;
}

// Order + colors are verbatim from the spec.
export const DASHBOARD_SEGMENTS: DashboardSegment[] = [
  {
    key: "pending",
    label: "PENDING",
    colorVar: "--neon-blue",
    bucket: "pending",
    match: (s) =>
      s === "pending" || s === "pending permit" || s === "pending engineering",
  },
  {
    key: "scheduled",
    label: "SCHEDULED",
    colorVar: "--neon-teal",
    bucket: "in_progress",
    match: (s) => s === "scheduled",
  },
  {
    key: "in_progress",
    label: "IN PROGRESS",
    colorVar: "--neon-cyan",
    bucket: "in_progress",
    match: (s) =>
      s === "in progress" ||
      s === "routed to sub" ||
      s === "pending splicing" ||
      s === "pending hsr",
  },
  {
    key: "ready",
    label: "READY",
    colorVar: "--neon-violet",
    bucket: "rts",
    match: (s) =>
      s === "rts" ||
      s.includes("ready to submit") ||
      (s.includes("fielded") && s.includes("rts")) ||
      (s.includes("fielded") && s.includes("coordination")),
  },
  {
    key: "submitted",
    label: "SUBMITTED",
    colorVar: "--neon-amber",
    bucket: null,
    match: (s) => s.includes("submitted"),
  },
  {
    key: "approved",
    label: "APPROVED",
    colorVar: "--neon-green",
    bucket: "completed",
    match: (s, job) => s.includes("approved") || isJobCompleted(job),
  },
];

export type StatusCounts = Record<DashboardSegmentKey, number>;

export function emptyStatusCounts(): StatusCounts {
  return {
    pending: 0,
    scheduled: 0,
    in_progress: 0,
    ready: 0,
    submitted: 0,
    approved: 0,
  };
}

// Assign each job to the first matching segment (priority = array order).
export function countByStatus(jobs: Job[]): StatusCounts {
  const counts = emptyStatusCounts();
  for (const job of jobs) {
    const s = (job.secondaryJobStatus ?? "").trim().toLowerCase();
    const seg = DASHBOARD_SEGMENTS.find((x) => x.match(s, job));
    if (seg) counts[seg.key] += 1;
  }
  return counts;
}
