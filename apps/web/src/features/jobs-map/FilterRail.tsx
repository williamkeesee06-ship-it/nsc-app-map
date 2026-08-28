// FilterRail — Phase 9: 6 status buckets (Needs Fielding, RTS, On Hold, Pending,
// In Progress, Completed). Default active = all except Completed.

import type { Job } from "@nsc/types";
import {
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
  /** Phase 9.7 (manager mode): active supervisor names (case-insensitive).
   *  Empty set = show all supervisors. */
  supervisors: Set<string>;
  showDigPolygons?: boolean;
  /** Ziply-only: limit to North Metro cities / construction base. Lumen ignores. */
  ziplyNorthMetroOnly?: boolean;
  /** Ziply-only: filter by print document / ingest state. Lumen ignores. */
  ziplyPrintFilter?: "all" | "has_print" | "no_print" | "processing" | "failed";
  /**
   * Ziply-only status groups. When set and non-empty, used instead of Lumen
   * status buckets for Ziply map pins. Empty/undefined = show all Ziply jobs.
   */
  ziplyStatusGroups?: Set<"not_started" | "in_progress" | "complete">;
  /** Ziply-only: active digital twin asset layers. */
  ziplyActiveLayers?: Set<string>;
  /**
   * Ziply-only: buckets the user wants HIDDEN from the map.
   * Empty/undefined = show everything. Populated = hide those bucket keys.
   * Uses the 7 pipeline buckets: commitment, in_progress, rts, ready_soon,
   * resto, gigs, on_hold. Backed by the Map Status Filter pill.
   */
  hiddenStatusBuckets?: Set<StatusBucket>;
  /** Global toggle to show/hide print overlays on the map. Default true. */
  showPrintOverlays?: boolean;
  /** Individual job IDs whose print overlays are hidden. */
  hiddenOverlayJobIds?: Set<string>;
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
    supervisors: new Set<string>(),
    showDigPolygons: true,
    showPrintOverlays: true,
    hiddenOverlayJobIds: new Set<string>(),
    // Ziply defaults: North Metro (Lake Stevens etc.) — Billy's current focus
    ziplyNorthMetroOnly: true,
    ziplyPrintFilter: "all",
    ziplyStatusGroups: new Set(),
    ziplyActiveLayers: new Set(["hub", "feeder", "distribution", "drop", "bore", "terminal", "service_point", "pole", "handhole"]),
    // Default: hide On Hold pins on the map. Billy 8/6: "I most likely will
    // never want to see my jobs on hold." User can flip it back on from the
    // Map Status Filter pill.
    hiddenStatusBuckets: new Set<StatusBucket>(["on_hold"]),
  };
}

export function applyFilters(jobs: Job[], f: Filters): Job[] {
  // Lowercase the supervisor set once for fast lookup.
  const supSet =
    f.supervisors && f.supervisors.size > 0
      ? new Set(Array.from(f.supervisors).map((s) => s.trim().toLowerCase()))
      : null;
  return jobs.filter((j) => {
    if (f.inTrackerOnly && !j.inTracker) return false;
    if (f.buckets && f.buckets.size > 0) {
      const b = bucketForJob(j);
      if (!f.buckets.has(b)) return false;
    }
    if (supSet) {
      const s = (j.constructionSupervisor ?? "").trim().toLowerCase();
      if (!supSet.has(s)) return false;
    }
    if (f.hideUnmapped) {
      if (!j.geocode || j.geocode.status !== "OK") return false;
    }
    // Map Status Filter (pill dropdown): buckets in this set are hidden.
    if (f.hiddenStatusBuckets && f.hiddenStatusBuckets.size > 0) {
      if (f.hiddenStatusBuckets.has(bucketForJob(j))) return false;
    }
    return true;
  });
}

interface Props {
  jobs: Job[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  /** Phase 9.7 (manager mode): when true, render supervisor checkboxes
   *  instead of status buckets. */
  managerMode?: boolean;
  /** Available supervisor names for manager-mode checkboxes. */
  availableSupervisors?: string[];
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

export default function FilterRail({
  jobs,
  filters,
  setFilters,
  managerMode = false,
  availableSupervisors = [],
}: Props) {
  const filteredCount = applyFilters(jobs, filters).length;

  // --- Manager mode: supervisor checkboxes -------------------------------
  if (managerMode) {
    const supCounts = new Map<string, number>();
    for (const j of jobs) {
      const s = (j.constructionSupervisor ?? "").trim();
      if (!s) continue;
      supCounts.set(s, (supCounts.get(s) ?? 0) + 1);
    }
    // Merge: any supervisor in availableSupervisors OR in jobs.
    const supMap = new Map<string, number>();
    for (const name of availableSupervisors) supMap.set(name, supCounts.get(name) ?? 0);
    for (const [name, n] of supCounts) {
      if (!supMap.has(name)) supMap.set(name, n);
    }
    const supList = Array.from(supMap.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    const toggleSupervisor = (name: string) => {
      const next = new Set(filters.supervisors);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      setFilters({ ...filters, supervisors: next });
    };

    return (
      <section className="rail-section rail-section--filters">
        <details className="filter-collapsible" open>
          <summary>
            <div className="filter-collapsible-header">
              <strong>SUPERVISOR FILTERS</strong>
              <NeonCountWidget shown={filteredCount} total={jobs.length} />
            </div>
            <span className="chevron">▼</span>
          </summary>

          <div className="filter-section">
            <div className="filter-section__body">
              {supList.map(([name, count]) => (
                <label key={name} className="check check--swatch">
                  <input
                    type="checkbox"
                    checked={filters.supervisors.has(name)}
                    onChange={() => toggleSupervisor(name)}
                  />
                  <span className="check__label">{name}</span>
                  <span className="check__count">{count}</span>
                </label>
              ))}
            </div>
          </div>

          {filters.supervisors.size > 0 && (
            <button
              className="link"
              style={{ marginTop: 4 }}
              onClick={() =>
                setFilters({ ...filters, supervisors: new Set<string>() })
              }
            >
              Clear supervisor filters
            </button>
          )}
        </details>
      </section>
    );
  }

  // --- Default mode: status buckets now live in the topbar StatusFilterPills.
  // Jobs-shown count widget hidden until the redesign is approved.
  void filteredCount;
  return null;
}
