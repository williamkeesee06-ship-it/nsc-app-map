// Hero job status bar — the 6 real STATUS_BUCKETS from markerStyle.ts
// (Needs Fielding / RTS / On Hold / Pending / In Progress / Completed) in
// their canonical order and colors. Each segment shows a live count and taps
// through to the Jobs tab pre-filtered to that bucket.

import { STATUS_BUCKETS, type StatusBucket } from "../../jobs-map/markerStyle.js";
import { bucketCoreColor, type BucketCounts } from "../dashboardStatus.js";

export interface JobStatusBarProps {
  counts: BucketCounts;
  onSelectBucket: (bucket: StatusBucket) => void;
}

export default function JobStatusBar({ counts, onSelectBucket }: JobStatusBarProps) {
  return (
    <div className="status-bar" role="region" aria-label="Job status overview">
      {STATUS_BUCKETS.map((seg) => (
        <button
          key={seg.key}
          type="button"
          className="status-bar__seg"
          style={{ ["--seg-color" as string]: bucketCoreColor(seg.key) }}
          aria-label={`${seg.label}: ${counts[seg.key]} jobs, tap to filter the map`}
          onClick={() => onSelectBucket(seg.key)}
        >
          <span className="status-bar__count">{counts[seg.key]}</span>
          <span className="status-bar__label">{seg.label}</span>
        </button>
      ))}
    </div>
  );
}
