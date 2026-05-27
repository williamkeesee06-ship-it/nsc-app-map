// StatusFilterPills — compact horizontal status-bucket toggles for the topbar.
// Same data model as the bucket section in FilterRail: clicking toggles the
// bucket in/out of filters.buckets, with live per-bucket counts.

import { useFiltersContext } from "./filtersContext.js";
import {
  MARKER_COLORS,
  STATUS_BUCKETS,
  bucketForJob,
  type StatusBucket,
} from "./markerStyle.js";

export default function StatusFilterPills() {
  const { filters, setFilters, jobs } = useFiltersContext();

  // Counts per bucket across all jobs.
  const counts = new Map<StatusBucket, number>();
  for (const j of jobs) {
    const b = bucketForJob(j);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }

  const toggleBucket = (b: StatusBucket) => {
    const next = new Set(filters.buckets);
    if (next.has(b)) next.delete(b);
    else next.add(b);
    setFilters({
      ...filters,
      buckets: next,
      hideCompleted: !next.has("completed"),
    });
  };

  return (
    <div className="status-pills" role="group" aria-label="Status filters">
      {STATUS_BUCKETS.map(({ key, label, colorKey }) => {
        const color = MARKER_COLORS[colorKey];
        const active = filters.buckets.has(key);
        const count = counts.get(key) ?? 0;
        return (
          <button
            key={key}
            type="button"
            className={`status-pill${active ? " status-pill--active" : ""}`}
            onClick={() => toggleBucket(key)}
            title={`${label} (${count})`}
            style={
              active
                ? {
                    background: `${color.core}22`,
                    borderColor: color.core,
                    boxShadow: `0 0 6px ${color.glow}`,
                  }
                : undefined
            }
          >
            <span
              className="status-pill__dot"
              style={{
                background: color.core,
                boxShadow: `0 0 4px ${color.glow}`,
              }}
              aria-hidden
            />
            <span className="status-pill__label">{label}</span>
            <span className="status-pill__count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
