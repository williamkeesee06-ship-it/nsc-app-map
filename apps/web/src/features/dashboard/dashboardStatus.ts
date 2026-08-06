// Hero status-bar tallies, wired to the app's real status model.
//
// There is one source of truth for job status: the 6 STATUS_BUCKETS in
// markerStyle.ts (needs_fielding / rts / on_hold / pending / in_progress /
// completed), assigned per job by bucketForJob(). The hero bar reuses that
// directly — no parallel label set, no "Submitted" stub.

import type { Job } from "@nsc/types";
import {
  MARKER_COLORS,
  STATUS_BUCKETS,
  bucketForJob,
  type StatusBucket,
} from "../jobs-map/markerStyle.js";

export type BucketCounts = Record<StatusBucket, number>;

export function emptyBucketCounts(): BucketCounts {
  return {
    commitment: 0,
    in_progress: 0,
    rts: 0,
    ready_soon: 0,
    resto: 0,
    gigs: 0,
    on_hold: 0,
    // Legacy buckets (kept in the type union for back-compat but no longer
    // populated by bucketForJob's Ziply path).
    needs_fielding: 0,
    pending: 0,
    completed: 0,
  };
}

export function countByBucket(jobs: Job[]): BucketCounts {
  const counts = emptyBucketCounts();
  for (const job of jobs) counts[bucketForJob(job)] += 1;
  return counts;
}

// The hero segment's neon color is the same core hue used for that bucket's
// map pin, so the dashboard and the map read as one system.
export function bucketCoreColor(bucket: StatusBucket): string {
  const def = STATUS_BUCKETS.find((b) => b.key === bucket);
  return MARKER_COLORS[def?.colorKey ?? "gray"].core;
}
