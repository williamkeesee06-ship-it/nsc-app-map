// Filter section of the left rail.
// Filters are pure-client: jobs come from /api/jobs, filter in-memory.
//
// Filter dimensions (Phase 2.1):
//   - inTrackerOnly       (boolean)
//   - hideUnmapped        (boolean)
//   - hideCompleted       (boolean)  ← Completed jobs go to their own bucket;
//                                       this toggles visibility of that bucket.
//   - secondaryStatuses   (Set<string>) ← raw secondary status strings; empty=all
//   - workTypeTags        (Set<string>) ← empty=all
//
// `statuses` (primary jobStatus) is retained on the Filters type for backwards
// compatibility but no longer rendered.

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
  workTypeTags: Set<string>;
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
    if (f.workTypeTags.size > 0) {
      const hit = j.workTypeTags.some((t) => f.workTypeTags.has(t));
      if (!hit) return false;
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

// Group an array of jobs by secondary status; produce a stable sorted list
// of [status, count] pairs.
function groupSecondaryStatuses(jobs: Job[]): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const j of jobs) {
    // Skip completed — they get their own section.
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
  const allTags = unique(jobs.flatMap((j) => j.workTypeTags));
  const completedCount = jobs.filter(isJobCompleted).length;

  const toggleSet = (
    key: "secondaryStatuses" | "workTypeTags",
    val: string
  ) => {
    const next = new Set(filters[key]);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    setFilters({ ...filters, [key]: next });
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
          Hide unmapped (no geocode)
        </label>
      </FilterSection>

      <FilterSection title={`Secondary Job Status (${secondaryStatuses.length})`}>
        {secondaryStatuses.map(({ status, count }) => {
          const key = colorKeyForSecondaryStatus(status);
          const color = MARKER_COLORS[key];
          return (
            <label key={status} className="check check--swatch">
              <input
                type="checkbox"
                checked={filters.secondaryStatuses.has(status)}
                onChange={() => toggleSet("secondaryStatuses", status)}
              />
              <span
                className="status-swatch"
                style={{
                  background: color.core,
                  boxShadow: `0 0 6px ${color.glow}`,
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
            Clear status
          </button>
        )}
      </FilterSection>

      <FilterSection title={`Completed Jobs (${completedCount})`}>
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
              boxShadow: `0 0 8px ${MARKER_COLORS.silver.glow}`,
            }}
            aria-hidden
          />
          <span className="check__label">Show completed (silver pins)</span>
          <span className="check__count">{completedCount}</span>
        </label>
        <div className="filter-section__hint">
          Completed jobs stay on the map even after they leave the tracker.
        </div>
      </FilterSection>

      <FilterSection title={`Work Type (${allTags.length})`}>
        {allTags.map((t) => (
          <label key={t} className="check">
            <input
              type="checkbox"
              checked={filters.workTypeTags.has(t)}
              onChange={() => toggleSet("workTypeTags", t)}
            />
            <span className="check__label">{t}</span>
          </label>
        ))}
        {filters.workTypeTags.size > 0 && (
          <button
            className="link"
            onClick={() => setFilters({ ...filters, workTypeTags: new Set() })}
          >
            Clear work type
          </button>
        )}
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

function unique(arr: (string | null | undefined)[]): string[] {
  return Array.from(new Set(arr.filter((v): v is string => Boolean(v)))).sort();
}
