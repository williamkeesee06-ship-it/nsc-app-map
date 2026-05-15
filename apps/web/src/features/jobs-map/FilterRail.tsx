// Left-side filter rail on the Jobs Map.
// Filters are pure-client: jobs come from /api/jobs, filter in-memory.
import type { Job } from "@nsc/types";

export interface Filters {
  inTrackerOnly: boolean;
  statuses: Set<string>; // empty = all
  workTypeTags: Set<string>; // empty = all
  hideUnmapped: boolean;
}

export function defaultFilters(): Filters {
  return {
    inTrackerOnly: true,
    statuses: new Set(),
    workTypeTags: new Set(),
    hideUnmapped: false,
  };
}

export function applyFilters(jobs: Job[], f: Filters): Job[] {
  return jobs.filter((j) => {
    if (f.inTrackerOnly && !j.inTracker) return false;
    if (f.statuses.size > 0) {
      if (!j.jobStatus || !f.statuses.has(j.jobStatus)) return false;
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

export default function FilterRail({ jobs, filters, setFilters }: Props) {
  // Compute available facets from the full set (so user knows what's there).
  const statuses = unique(jobs.map((j) => j.jobStatus));
  const allTags = unique(jobs.flatMap((j) => j.workTypeTags));

  const toggleSet = (key: "statuses" | "workTypeTags", val: string) => {
    const next = new Set(filters[key]);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    setFilters({ ...filters, [key]: next });
  };

  const filteredCount = applyFilters(jobs, filters).length;

  return (
    <aside className="filter-rail">
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

      <FilterSection title={`Job Status (${statuses.length})`}>
        {statuses.map((s) => (
          <label key={s} className="check">
            <input
              type="checkbox"
              checked={filters.statuses.has(s)}
              onChange={() => toggleSet("statuses", s)}
            />
            {s}
          </label>
        ))}
        {filters.statuses.size > 0 && (
          <button
            className="link"
            onClick={() => setFilters({ ...filters, statuses: new Set() })}
          >
            Clear status
          </button>
        )}
      </FilterSection>

      <FilterSection title={`Work Type (${allTags.length})`}>
        {allTags.map((t) => (
          <label key={t} className="check">
            <input
              type="checkbox"
              checked={filters.workTypeTags.has(t)}
              onChange={() => toggleSet("workTypeTags", t)}
            />
            {t}
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
    </aside>
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
