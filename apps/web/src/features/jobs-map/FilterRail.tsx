// Filter rail — Phase 4: Work Type filters removed.
// Remaining: View toggles, Secondary Job Status chips, Completed Jobs toggle.

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
    inTrackerOnly: true,
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

  return (
    <section className="rail-section rail-section--filters">
      <div className="filter-rail__header">
        <strong>Filters</strong>
        <span className="filter-rail__count">
          {filteredCount} / {jobs.length}
        </span>
      </div>

      <FilterSection title="View">
        <label className="check">
          <input
            type="checkbox"
            checked={filters.inTrackerOnly}
            onChange={(e) =>
              setFilters({ ...filters, inTrackerOnly: e.target.checked })
            }
          />
          On-tracker only
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={filters.hideUnmapped}
            onChange={(e) =>
              setFilters({ ...filters, hideUnmapped: e.target.checked })
            }
          />
          Hide unmapped
        </label>
      </FilterSection>

      <FilterSection title={`Status (${secondaryStatuses.length})`}>
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
      </FilterSection>

      <FilterSection title={`Completed (${completedCount})`}>
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
      </FilterSection>
    </section>
  );
}

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="filter-section">
      <div className="filter-section__title">{title}</div>
      <div className="filter-section__body">{children}</div>
    </div>
  );
}
