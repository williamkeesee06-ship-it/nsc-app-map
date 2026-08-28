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

// Icon glyph for each of the 7 Ziply buckets. Kept minimal (24×24 stroke
// SVGs) so they render sharp inside the RadialGauge center regardless of
// gauge size. `currentColor` lets us tint each icon with the bucket's core
// neon color via the parent button's `--seg-color` variable.
const BUCKET_ICONS: Partial<Record<StatusBucket, ReactNode>> = {
  // Commitment — handshake / seal ring
  commitment: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  // In Progress — rotating arrow
  in_progress: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <path d="M4 12a8 8 0 1 1 8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 12l-2-2M4 12l2-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  // RTS — checkmark (ready-to-start)
  rts: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <path d="M5 12l5 5 9-11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  // Ready Soon — clock face
  ready_soon: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l4 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  // Resto — recycle / repair loop
  resto: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <path d="M6 15a7 7 0 0 1 12-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 9v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  // Gigs — punch-list / tool
  gigs: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <path d="M7 17l4-4 6 6-4 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M14 10l3-3-2-2-3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  ),
  // On Hold — double pause bars
  on_hold: (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
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
