// FilterRail — Phase 9: 6 status buckets (Needs Fielding, RTS, On Hold, Pending,
// In Progress, Completed). Default active = all except Completed.

import type { Job } from "@nsc/types";
import {
  MARKER_COLORS,
  STATUS_BUCKETS,
  bucketForJob,
  type StatusBucket,
} from "./markerStyle.js";

export interface Filters {
  inTrackerOnly: boolean;
  hideUnmapped: boolean;
  /** Phase 9: deprecated — derived from buckets.has("completed"). Kept for compat. */
  hideCompleted: boolean;
  statuses: Set<string>; // deprecated, kept for compat
  /** Phase 9: deprecated raw secondary status set, kept for compat. */
  secondaryStatuses: Set<string>;
  /** Phase 9: active status buckets. Empty set = show all. */
  buckets: Set<StatusBucket>;
  workTypeTags: Set<string>; // kept on type for compat, no longer used in UI
}

export function defaultFilters(): Filters {
  return {
    inTrackerOnly: false,
    hideUnmapped: false,
    hideCompleted: true,
    statuses: new Set(),
    secondaryStatuses: new Set(),
    buckets: new Set<StatusBucket>([
      "needs_fielding",
      "rts",
      "on_hold",
      "pending",
      "in_progress",
    ]),
    workTypeTags: new Set(),
  };
}

export function applyFilters(jobs: Job[], f: Filters): Job[] {
  return jobs.filter((j) => {
    if (f.inTrackerOnly && !j.inTracker) return false;
    if (f.buckets && f.buckets.size > 0) {
      const b = bucketForJob(j);
      if (!f.buckets.has(b)) return false;
    }
    if (f.hideUnmapped) {
      if (!j.geocode || j.geocode.status !== "OK") return false;
    }
    return true;
  });
}

interface Props {
  jobs: Job[];
  filters: Filters;
  setFilters: (f: Filters) => void;
}

// Circular neon widget: animated progress ring showing shown / total jobs.
// The arc length tracks the fraction; the center reads the live count.
function NeonCountWidget({ shown, total }: { shown: number; total: number }) {
  const size = 54;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.max(0, Math.min(1, shown / total)) : 0;
  const dash = c * pct;
  return (
    <span
      className="neon-count-widget"
      role="img"
      aria-label={`${shown} of ${total} jobs shown`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="ncw-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#1ea7ff" />
            <stop offset="50%"  stopColor="#39ff14" />
            <stop offset="100%" stopColor="#c44dff" />
          </linearGradient>
          <filter id="ncw-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ncw-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          filter="url(#ncw-glow)"
          style={{ transition: "stroke-dasharray 360ms ease" }}
        />
      </svg>
      <span className="neon-count-widget__center">
        <span className="neon-count-widget__num">{shown}</span>
        <span className="neon-count-widget__div" />
        <span className="neon-count-widget__den">{total}</span>
      </span>
    </span>
  );
}

export default function FilterRail({ jobs, filters, setFilters }: Props) {
  // Count per bucket across all jobs
  const counts = new Map<StatusBucket, number>();
  for (const j of jobs) {
    const b = bucketForJob(j);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }

  const toggleBucket = (b: StatusBucket) => {
    const next = new Set(filters.buckets);
    if (next.has(b)) next.delete(b);
    else next.add(b);
    setFilters({ ...filters, buckets: next });
  };

  const filteredCount = applyFilters(jobs, filters).length;
  const activeFilters = filters.buckets.size;

  return (
    <section className="rail-section rail-section--filters">
      <details className="filter-collapsible" open>
        <summary>
          <div className="filter-collapsible-header">
            <strong>STATUS FILTERS</strong>
            <NeonCountWidget shown={filteredCount} total={jobs.length} />
          </div>
          <span className="chevron">▼</span>
        </summary>

        <div className="filter-section">
          <div className="filter-section__body">
            {STATUS_BUCKETS.map(({ key, label, colorKey }) => {
              const color = MARKER_COLORS[colorKey];
              const count = counts.get(key) ?? 0;
              return (
                <label key={key} className="check check--swatch">
                  <input
                    type="checkbox"
                    checked={filters.buckets.has(key)}
                    onChange={() => toggleBucket(key)}
                  />
                  <span
                    className="status-swatch"
                    style={{
                      background: color.core,
                      boxShadow: `0 0 4px ${color.glow}`,
                    }}
                    aria-hidden
                  />
                  <span className="check__label">{label}</span>
                  <span className="check__count">{count}</span>
                </label>
              );
            })}
          </div>
        </div>

        {activeFilters > 0 && (
          <button
            className="link"
            style={{ marginTop: 4 }}
            onClick={() =>
              setFilters({
                ...filters,
                buckets: new Set<StatusBucket>(),
              })
            }
          >
            Clear all filters
          </button>
        )}
      </details>
    </section>
  );
}
