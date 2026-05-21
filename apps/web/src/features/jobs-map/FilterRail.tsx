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
            <span className="filter-rail__count">
              {filteredCount} / {jobs.length}
            </span>
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
