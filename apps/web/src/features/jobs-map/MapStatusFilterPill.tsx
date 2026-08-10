// Map Status Filter Pill — floating dropdown that lets Billy toggle
// individual status buckets on/off directly on the map. Default state hides
// "On Hold" pins (Billy 8/6: "I most likely will never want to see my jobs on
// hold, so I should be able to just filter them off").
//
// Design intent:
//   • Compact glass pill matching the map's neon UI language.
//   • Click to expand a vertical menu of the 7 pipeline buckets, each with
//     its bucket color, label, and a live count of currently-visible jobs.
//   • Toggling a bucket flips its membership in `filters.hiddenStatusBuckets`.
//   • Live count in the pill label shows how many buckets are hidden so Billy
//     always knows something's filtered without opening the menu.
//
// This component is presentational — actual filtering happens in
// `FilterRail.applyFilters` via the `hiddenStatusBuckets` field.

import { useEffect, useMemo, useRef, useState, memo } from "react";
import type { Job } from "@nsc/types";
import type { Filters } from "./FilterRail.js";
import { useFiltersContext } from "./filtersContext.js";
import {
  STATUS_BUCKETS,
  MARKER_COLORS,
  bucketForJob,
  bucketColorKey,
  type StatusBucket,
} from "./markerStyle.js";
import "./mapStatusFilterPill.css";

interface Props {
  jobs?: Job[];
  filters?: Filters;
  setFilters?: (f: Filters) => void;
}

function MapStatusFilterPill(props: Props) {
  const ctx = useFiltersContext();
  const filters = props.filters ?? ctx.filters;
  const setFilters = props.setFilters ?? ctx.setFilters;
  const jobs = props.jobs ?? ctx.jobs;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Bucket → count map, computed from the full unfiltered job list so counts
  // reflect what's actually available, not what's currently visible after
  // hidden buckets are removed.
  const counts = useMemo(() => {
    const c: Record<StatusBucket, number> = {
      commitment: 0,
      in_progress: 0,
      rts: 0,
      ready_soon: 0,
      resto: 0,
      gigs: 0,
      on_hold: 0,
      // Legacy buckets — surfaced only if a real job resolves to one, so we
      // still count them defensively (won't render in the menu unless > 0).
      needs_fielding: 0,
      pending: 0,
      completed: 0,
    };
    for (const j of jobs) {
      c[bucketForJob(j)] += 1;
    }
    return c;
  }, [jobs]);

  const hidden = filters.hiddenStatusBuckets ?? new Set<StatusBucket>();
  const hiddenCount = hidden.size;

  const toggle = (key: StatusBucket) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFilters({ ...filters, hiddenStatusBuckets: next });
  };

  const clearAll = () => {
    setFilters({ ...filters, hiddenStatusBuckets: new Set() });
  };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="map-status-filter-pill" ref={rootRef}>
      <button
        type="button"
        className={`msfp-trigger${hiddenCount > 0 ? " msfp-trigger--active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={
          hiddenCount === 0
            ? "Filter map pins by status"
            : `${hiddenCount} status ${hiddenCount === 1 ? "bucket" : "buckets"} hidden`
        }
      >
        <span className="msfp-dot" aria-hidden="true" />
        <span className="msfp-label">FILTERS</span>
        {hiddenCount > 0 && (
          <span className="msfp-badge">−{hiddenCount}</span>
        )}
        <span className="msfp-chevron" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="msfp-menu" role="listbox">
          <div className="msfp-menu__header">
            <span>Show buckets</span>
            {hiddenCount > 0 && (
              <button
                type="button"
                className="msfp-clear"
                onClick={clearAll}
                title="Show all buckets"
              >
                Clear
              </button>
            )}
          </div>
          <div className="msfp-menu__list">
            {STATUS_BUCKETS.map((b) => {
              const isVisible = !hidden.has(b.key);
              const color = MARKER_COLORS[bucketColorKey(b.key)];
              const count = counts[b.key] ?? 0;
              return (
                <button
                  key={b.key}
                  type="button"
                  className={`msfp-item${isVisible ? " msfp-item--on" : " msfp-item--off"}`}
                  onClick={() => toggle(b.key)}
                  role="option"
                  aria-selected={isVisible}
                >
                  <span
                    className="msfp-swatch"
                    style={{ background: color?.core ?? "#666", boxShadow: color?.glow ? `0 0 8px ${color.glow}` : undefined }}
                    aria-hidden="true"
                  />
                  <span className="msfp-item__label">{b.label}</span>
                  <span className="msfp-item__count">{count}</span>
                  <span className="msfp-item__toggle" aria-hidden="true">
                    {isVisible ? "●" : "○"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(MapStatusFilterPill);
