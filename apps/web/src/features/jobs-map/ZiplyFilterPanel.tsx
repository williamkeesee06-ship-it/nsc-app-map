import { useMemo, useState } from "react";
import type { Job } from "@nsc/types";
import type { Filters } from "./FilterRail.js";
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  getZiplyPrintDocStatus,
  isNorthMetroJob,
  type ZiplyPrintFilter,
  type ZiplyStatusGroup,
  ziplyPrintStatusColor,
  ziplyPrintStatusLabel,
  ziplyStatusGroupForJob,
} from "../ziply/ziplyUtils.js";

interface Props {
  jobs: Job[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  ziplyPrintLayerVisible: boolean;
  setZiplyPrintLayerVisible: (v: boolean) => void;
  ziply811OverlayVisible: boolean;
  setZiply811OverlayVisible: (v: boolean) => void;
}

const STATUS_GROUPS: { id: ZiplyStatusGroup; label: string }[] = [
  { id: "not_started", label: "Not Started" },
  { id: "in_progress", label: "In Progress" },
  { id: "complete", label: "Complete" },
];

const PRINT_FILTERS: { id: ZiplyPrintFilter; label: string }[] = [
  { id: "all", label: "All jobs" },
  { id: "has_print", label: "Print on map" },
  { id: "processing", label: "Ingesting…" },
  { id: "no_print", label: "No print yet" },
  { id: "failed", label: "Ingest failed" },
];

export default function ZiplyFilterPanel({
  jobs,
  filters,
  setFilters,
  ziplyPrintLayerVisible,
  setZiplyPrintLayerVisible,
  ziply811OverlayVisible,
  setZiply811OverlayVisible,
}: Props) {
  const ziplyJobs = useMemo(
    () => jobs.filter((j) => j.customerProject === "Ziply"),
    [jobs]
  );

  const northMetroJobs = useMemo(
    () => ziplyJobs.filter(isNorthMetroJob),
    [ziplyJobs]
  );

  const printCounts = useMemo(() => {
    const c = { ready: 0, processing: 0, failed: 0, none: 0 };
    for (const j of ziplyJobs) {
      c[getZiplyPrintDocStatus(j)]++;
    }
    return c;
  }, [ziplyJobs]);

  const getStatusCount = (group: ZiplyStatusGroup) =>
    ziplyJobs.filter((j) => ziplyStatusGroupForJob(j) === group).length;

  const groups = filters.ziplyStatusGroups ?? new Set<ZiplyStatusGroup>();

  const handleStatusToggle = (group: ZiplyStatusGroup) => {
    const next = new Set(groups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setFilters({ ...filters, ziplyStatusGroups: next });
  };

  const isStatusChecked = (group: ZiplyStatusGroup) => {
    // Empty set = all groups visible
    if (!groups || groups.size === 0) return true;
    return groups.has(group);
  };

  const jobsBySite = useMemo(() => {
    const map = new Map<string, Job[]>();
    const pool = filters.ziplyNorthMetroOnly ? northMetroJobs : ziplyJobs;
    for (const j of pool) {
      const site = (j.city || "Unknown Site").trim();
      if (!map.has(site)) map.set(site, []);
      map.get(site)!.push(j);
    }
    return map;
  }, [ziplyJobs, northMetroJobs, filters.ziplyNorthMetroOnly]);

  const sites = useMemo(() => Array.from(jobsBySite.keys()).sort(), [jobsBySite]);
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());

  const toggleSite = (site: string) => {
    const next = new Set(expandedSites);
    if (next.has(site)) next.delete(site);
    else next.add(site);
    setExpandedSites(next);
  };

  const handlePanToSite = (site: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const siteJobs = jobsBySite.get(site) || [];
    const validJobs = siteJobs.filter(
      (j) => j.geocode?.status === "OK" && j.geocode.lat && j.geocode.lng
    );
    if (validJobs.length > 0) {
      const bounds = validJobs.map((j) => ({
        lat: j.geocode!.lat,
        lng: j.geocode!.lng,
      }));
      window.dispatchEvent(new CustomEvent("nsc:pan-to", { detail: { bounds } }));
      setZiplyPrintLayerVisible(true);
    }
  };

  const visibleEstimate = useMemo(() => {
    let list = ziplyJobs;
    if (filters.ziplyNorthMetroOnly) list = list.filter(isNorthMetroJob);
    if (filters.ziplyPrintFilter && filters.ziplyPrintFilter !== "all") {
      list = list.filter((j) => {
        const st = getZiplyPrintDocStatus(j);
        const f = filters.ziplyPrintFilter!;
        if (f === "has_print") return st === "ready";
        if (f === "no_print") return st === "none";
        if (f === "processing") return st === "processing";
        if (f === "failed") return st === "failed";
        return true;
      });
    }
    if (groups.size > 0) {
      list = list.filter((j) => groups.has(ziplyStatusGroupForJob(j)));
    }
    return list.length;
  }, [ziplyJobs, filters, groups]);

  return (
    <div
      style={{
        padding: 12,
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <h3
          style={{
            margin: "0 0 4px 0",
            fontSize: 13,
            letterSpacing: "0.05em",
            color: "#00E676",
          }}
        >
          ZIPLY MAP FILTERS
        </h3>
        <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>
          Showing ~{visibleEstimate} of {ziplyJobs.length} Ziply jobs
          {filters.ziplyNorthMetroOnly
            ? ` · North Metro (${northMetroJobs.length})`
            : ""}
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 9, color: "#6b7280" }}>
          Print docs: {printCounts.ready} on map · {printCounts.processing}{" "}
          ingesting · {printCounts.none} none · {printCounts.failed} failed
        </p>
      </div>

      {/* North Metro */}
      <div
        style={{
          padding: 8,
          background: "rgba(0,230,118,0.08)",
          border: "1px solid rgba(0,230,118,0.25)",
          borderRadius: 6,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <input
            type="checkbox"
            checked={!!filters.ziplyNorthMetroOnly}
            onChange={(e) =>
              setFilters({ ...filters, ziplyNorthMetroOnly: e.target.checked })
            }
            style={{ accentColor: "#00E676" }}
          />
          <span>NORTH METRO ONLY</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#6b7280" }}>
            {northMetroJobs.length}
          </span>
        </label>
        <p style={{ margin: "4px 0 0 20px", fontSize: 9, color: "#9ca3af" }}>
          Filters to North Metro cities (Lynnwood, Everett, Edmonds, …) or jobs
          whose construction base says North Metro.
        </p>
      </div>

      {/* Print document filter */}
      <div>
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            marginBottom: 6,
            textTransform: "uppercase",
            color: "#9ca3af",
            letterSpacing: "0.05em",
          }}
        >
          Print documents
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {PRINT_FILTERS.map((opt) => (
            <label
              key={opt.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 8px",
                background:
                  (filters.ziplyPrintFilter ?? "all") === opt.id
                    ? "rgba(0,230,118,0.12)"
                    : "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 4,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="ziply-print-filter"
                checked={(filters.ziplyPrintFilter ?? "all") === opt.id}
                onChange={() =>
                  setFilters({ ...filters, ziplyPrintFilter: opt.id })
                }
                style={{ accentColor: "#00E676" }}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Map layers */}
      <div
        style={{
          padding: 8,
          background: "rgba(0,230,118,0.06)",
          border: "1px solid rgba(0,230,118,0.15)",
          borderRadius: 6,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <input
            type="checkbox"
            checked={ziplyPrintLayerVisible}
            onChange={(e) => setZiplyPrintLayerVisible(e.target.checked)}
            style={{ accentColor: "#00E676" }}
          />
          <span>SHOW PRINT DESIGN LAYER</span>
        </label>
        <p style={{ margin: "4px 0 0 20px", fontSize: 9, color: "#9ca3af" }}>
          Overlay hubs, terminals, and cables for jobs that already ingested a
          print ({printCounts.ready} ready).
        </p>
      </div>

      <div
        style={{
          padding: 8,
          background: "rgba(250,204,21,0.07)",
          border: "1px solid rgba(250,204,21,0.22)",
          borderRadius: 6,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <input
            type="checkbox"
            checked={ziply811OverlayVisible}
            onChange={(e) => setZiply811OverlayVisible(e.target.checked)}
            style={{ accentColor: "#FACC15" }}
          />
          <span style={{ color: "#FACC15" }}>811 CLEARANCE BY SECTION</span>
        </label>
      </div>

      {/* Job status */}
      <div>
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            marginBottom: 6,
            textTransform: "uppercase",
            color: "#9ca3af",
            letterSpacing: "0.05em",
          }}
        >
          Status{" "}
          <span style={{ fontWeight: 500, textTransform: "none" }}>
            (empty = all)
          </span>
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {STATUS_GROUPS.map(({ id, label }) => (
            <label
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 8px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 4,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={isStatusChecked(id)}
                  onChange={() => handleStatusToggle(id)}
                  style={{ accentColor: "#00E676" }}
                />
                <span>{label}</span>
              </div>
              <span style={{ fontSize: 10, color: "#6b7280" }}>
                {getStatusCount(id)}
              </span>
            </label>
          ))}
        </div>
        {groups.size > 0 && (
          <button
            type="button"
            onClick={() =>
              setFilters({ ...filters, ziplyStatusGroups: new Set() })
            }
            style={{
              marginTop: 6,
              background: "none",
              border: "none",
              color: "#38bdf8",
              fontSize: 10,
              cursor: "pointer",
              padding: 0,
            }}
          >
            Clear status filter (show all)
          </button>
        )}
      </div>

      {/* Sites */}
      <div>
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            marginBottom: 6,
            textTransform: "uppercase",
            color: "#9ca3af",
            letterSpacing: "0.05em",
          }}
        >
          Sites (by city)
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sites.map((site) => {
            const isExpanded = expandedSites.has(site);
            const siteJobs = jobsBySite.get(site)!;
            const readyCount = siteJobs.filter(
              (j) => getZiplyPrintDocStatus(j) === "ready"
            ).length;
            return (
              <div key={site} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div
                  onClick={() => toggleSite(site)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {isExpanded ? (
                      <ChevronDown size={14} color="#9ca3af" />
                    ) : (
                      <ChevronRight size={14} color="#9ca3af" />
                    )}
                    <span style={{ fontSize: 11, fontWeight: 600 }}>{site}</span>
                    <span style={{ fontSize: 9, color: "#6b7280" }}>
                      {siteJobs.length} jobs · {readyCount} prints
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handlePanToSite(site, e)}
                    style={{
                      background: "var(--accent, #00E676)",
                      border: "none",
                      borderRadius: 12,
                      color: "#000",
                      fontSize: 9,
                      fontWeight: 800,
                      padding: "2px 8px",
                      cursor: "pointer",
                    }}
                  >
                    GO TO SITE
                  </button>
                </div>
                {isExpanded && (
                  <div
                    style={{
                      paddingLeft: 16,
                      marginTop: 4,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {siteJobs.map((job) => {
                      const pst = getZiplyPrintDocStatus(job);
                      return (
                        <div
                          key={job.jobId}
                          style={{
                            fontSize: 10,
                            color: "#cbd5e1",
                            display: "grid",
                            gridTemplateColumns: "1fr auto auto",
                            gap: 6,
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                            paddingBottom: 3,
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={job.workOrder}
                          >
                            {job.workOrder}
                            {job.hubNumber ? ` · H${job.hubNumber}` : ""}
                          </span>
                          <span
                            style={{
                              color: ziplyPrintStatusColor(pst),
                              fontWeight: 700,
                              fontSize: 9,
                            }}
                            title={ziplyPrintStatusLabel(pst)}
                          >
                            {pst === "ready"
                              ? "PRINT"
                              : pst === "processing"
                                ? "…"
                                : pst === "failed"
                                  ? "FAIL"
                                  : "—"}
                          </span>
                          <span
                            style={{
                              color:
                                job.jobStatus === "Complete" ? "#00E676" : "#4facfe",
                              fontSize: 9,
                            }}
                          >
                            {(job.jobStatus || "NS").slice(0, 12)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Options */}
      <div>
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            marginBottom: 6,
            textTransform: "uppercase",
            color: "#9ca3af",
            letterSpacing: "0.05em",
          }}
        >
          Options
        </span>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            cursor: "pointer",
            marginBottom: 6,
          }}
        >
          <input
            type="checkbox"
            checked={filters.hideUnmapped}
            onChange={(e) =>
              setFilters({ ...filters, hideUnmapped: e.target.checked })
            }
            style={{ accentColor: "#00E676" }}
          />
          <span>Hide unmapped jobs</span>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            cursor: "pointer",
            marginBottom: 6,
          }}
        >
          <input
            type="checkbox"
            checked={filters.inTrackerOnly}
            onChange={(e) =>
              setFilters({ ...filters, inTrackerOnly: e.target.checked })
            }
            style={{ accentColor: "#00E676" }}
          />
          <span>On tracker only</span>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            cursor: "pointer",
            marginTop: 8,
            padding: "6px 8px",
            background: "rgba(250, 204, 21, 0.1)",
            border: "1px solid rgba(250, 204, 21, 0.3)",
            borderRadius: 4,
          }}
        >
          <input
            type="checkbox"
            checked={filters.showDigPolygons ?? true}
            onChange={(e) =>
              setFilters({ ...filters, showDigPolygons: e.target.checked })
            }
            style={{ accentColor: "#FACC15" }}
          />
          <span style={{ color: "#FACC15", fontWeight: 700 }}>
            SHOW 811 DIG TICKETS
          </span>
        </label>
      </div>
    </div>
  );
}
