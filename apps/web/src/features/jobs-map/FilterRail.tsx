// Filter rail — Phase 4.1: Removed "On-tracker only" + "Hide unmapped" checkboxes.
// STATUS FILTERS section is collapsible, collapsed by default.

import type { Job } from "@nsc/types";
import {
  MARKER_COLORS,
  colorKeyForSecondaryStatus,
  isJobCompleted,
} from "./markerStyle.js";

export interface Filters {
  inTrackerOnly: boolean;
  hideUnmapped: boolean;
  hideCompleted: boolean;
  statuses: Set<string>; // deprecated, kept for compat
  secondaryStatuses: Set<string>;
  workTypeTags: Set<string>; // kept on type for compat, no longer used in UI
}

export function defaultFilters(): Filters {
  return {
    inTrackerOnly: false,
    hideUnmapped: false,
    hideCompleted: false,
    statuses: new Set(),
    secondaryStatuses: new Set(),
    workTypeTags: new Set(),
  };
}

export function applyFilters(jobs: Job[], f: Filters): Job[] {
  return jobs.filter((j) => {
    if (f.inTrackerOnly && !j.inTracker) return false;
    if (f.hideCompleted && isJobCompleted(j)) return false;
    if (f.secondaryStatuses.size > 0) {
      if (!j.secondaryJobStatus || !f.secondaryStatuses.has(j.secondaryJobStatus))
        return false;
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

function groupSecondaryStatuses(jobs: Job[]): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const j of jobs) {
    if (isJobCompleted(j)) continue;
    const s = j.secondaryJobStatus?.trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => a.status.localeCompare(b.status));
}

export default function FilterRail({ jobs, filters, setFilters }: Props) {
  const secondaryStatuses = groupSecondaryStatuses(jobs);
  const completedCount = jobs.filter(isJobCompleted).length;

  const toggleSecondary = (val: string) => {
    const next = new Set(filters.secondaryStatuses);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    setFilters({ ...filters, secondaryStatuses: next });
  };

  const filteredCount = applyFilters(jobs, filters).length;
  const totalStatusCount = secondaryStatuses.length + (completedCount > 0 ? 1 : 0);
  const activeFilters = filters.secondaryStatuses.size + (filters.hideCompleted ? 1 : 0);

  return (
    <section className="rail-section rail-section--filters">
      {/* Collapsible STATUS FILTERS — collapsed by default */}
      <details className="filter-collapsible">
        <summary>
          <div className="filter-collapsible-header">
            <strong>STATUS FILTERS</strong>
            <span className="filter-rail__count">
              {filteredCount} / {jobs.length}
            </span>
          </div>
          <span className="chevron">▼</span>
        </summary>

        {/* Secondary status chips */}
        {secondaryStatuses.length > 0 && (
          <div className="filter-section">
            <div className="filter-section__title">
              Status ({secondaryStatuses.length})
            </div>
            <div className="filter-section__body">
              {secondaryStatuses.map(({ status, count }) => {
                const key = colorKeyForSecondaryStatus(status);
                const color = MARKER_COLORS[key];
                return (
                  <label key={status} className="check check--swatch">
                    <input
                      type="checkbox"
                      checked={filters.secondaryStatuses.has(status)}
                      onChange={() => toggleSecondary(status)}
                    />
                    <span
                      className="status-swatch"
                      style={{
                        background: color.core,
                        boxShadow: `0 0 4px ${color.glow}`,
                      }}
                      aria-hidden
                    />
                    <span className="check__label">{status}</span>
                    <span className="check__count">{count}</span>
                  </label>
                );
              })}
              {filters.secondaryStatuses.size > 0 && (
                <button
                  className="link"
                  onClick={() =>
                    setFilters({ ...filters, secondaryStatuses: new Set() })
                  }
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Completed jobs toggle */}
        <div className="filter-section">
          <div className="filter-section__title">
            Completed ({completedCount})
          </div>
          <div className="filter-section__body">
            <label className="check check--swatch">
              <input
                type="checkbox"
                checked={!filters.hideCompleted}
                onChange={(e) =>
                  setFilters({ ...filters, hideCompleted: !e.target.checked })
                }
              />
              <span
                className="status-swatch status-swatch--silver"
                style={{
                  background: MARKER_COLORS.silver.core,
                  boxShadow: `0 0 6px ${MARKER_COLORS.silver.glow}`,
                }}
                aria-hidden
              />
              <span className="check__label">Show completed (silver pins)</span>
              <span className="check__count">{completedCount}</span>
            </label>
            <div className="filter-section__hint">
              Completed jobs stay on the map after leaving the tracker.
            </div>
          </div>
        </div>

        {/* Clear all filters */}
        {activeFilters > 0 && (
          <button
            className="link"
            style={{ marginTop: 4 }}
            onClick={() =>
              setFilters({
                ...filters,
                secondaryStatuses: new Set(),
                hideCompleted: false,
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
