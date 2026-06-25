// Hero job status bar — 6 segments rendered verbatim from the spec
// (PENDING / SCHEDULED / IN PROGRESS / READY / SUBMITTED / APPROVED). Each
// segment shows a live count and, when it maps to a real filter bucket, taps
// through to the Jobs tab pre-filtered. See dashboardStatus.ts for the
// status-label reconciliation against the live secondaryJobStatus picklist.

import { DASHBOARD_SEGMENTS, type StatusCounts } from "../dashboardStatus.js";
import type { StatusBucket } from "../../jobs-map/markerStyle.js";

export interface JobStatusBarProps {
  counts: StatusCounts;
  onSelectBucket: (bucket: StatusBucket) => void;
}

export default function JobStatusBar({ counts, onSelectBucket }: JobStatusBarProps) {
  return (
    <div className="status-bar" role="region" aria-label="Job status overview">
      {DASHBOARD_SEGMENTS.map((seg) => {
        const count = counts[seg.key];
        const clickable = seg.bucket !== null;
        return (
          <button
            key={seg.key}
            type="button"
            className="status-bar__seg"
            style={{ ["--seg-color" as string]: `var(${seg.colorVar})` }}
            disabled={!clickable}
            aria-label={`${seg.label}: ${count} jobs${clickable ? ", tap to filter the map" : ""}`}
            onClick={clickable ? () => onSelectBucket(seg.bucket as StatusBucket) : undefined}
          >
            <span className="status-bar__count">{count}</span>
            <span className="status-bar__label">{seg.label}</span>
          </button>
        );
      })}
    </div>
  );
}
