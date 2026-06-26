// Hero job status bar — the 6 real STATUS_BUCKETS from markerStyle.ts
// (Needs Fielding / RTS / On Hold / Pending / In Progress / Completed) in
// their canonical order and colors. Each segment shows a live count and taps
// through to the Jobs tab pre-filtered to that bucket.

import type { ReactNode } from "react";
import { STATUS_BUCKETS, type StatusBucket } from "../../jobs-map/markerStyle.js";
import { bucketCoreColor, type BucketCounts } from "../dashboardStatus.js";
import Bezel from "../components/Bezel.js";
import RadialGauge from "../components/RadialGauge.js";

export interface JobStatusBarProps {
  counts: BucketCounts;
  onSelectBucket: (bucket: StatusBucket) => void;
}

const BUCKET_ICONS: Record<StatusBucket, ReactNode> = {
  needs_fielding: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v4l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  rts: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <path d="M5 12l5 5 9-11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  on_hold: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  ),
  pending: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l4 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  in_progress: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <path d="M4 12a8 8 0 1 1 8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 12l-2-2M4 12l2-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  completed: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8.5 12l2.5 2.5L16 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

export default function JobStatusBar({ counts, onSelectBucket }: JobStatusBarProps) {
  const total = STATUS_BUCKETS.reduce((sum, seg) => sum + counts[seg.key], 0);

  return (
    <Bezel className="status-bar">
      <div className="status-bar__row" role="region" aria-label="Job status overview">
        {STATUS_BUCKETS.map((seg) => {
          const color = bucketCoreColor(seg.key);
          return (
            <button
              key={seg.key}
              type="button"
              className="status-bar__seg"
              style={{ ["--seg-color" as string]: color }}
              aria-label={`${seg.label}: ${counts[seg.key]} jobs, tap to filter the map`}
              onClick={() => onSelectBucket(seg.key)}
            >
              <RadialGauge
                value={counts[seg.key]}
                max={total || undefined}
                display={String(counts[seg.key])}
                label={seg.label}
                color={color}
                icon={BUCKET_ICONS[seg.key]}
                size={120}
              />
            </button>
          );
        })}
      </div>
    </Bezel>
  );
}
