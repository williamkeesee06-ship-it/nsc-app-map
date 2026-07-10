import { useState } from "react";
import type { Job } from "@nsc/types";
import type { Filters } from "./FilterRail.js";
import { ChevronRight, ChevronDown } from "lucide-react";

interface Props {
  jobs: Job[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  // Extra fields we add for Ziply
  ziplyPrintLayerVisible: boolean;
  setZiplyPrintLayerVisible: (v: boolean) => void;
  ziply811OverlayVisible: boolean;
  setZiply811OverlayVisible: (v: boolean) => void;
}

export default function ZiplyFilterPanel({
  jobs,
  filters,
  setFilters,
  ziplyPrintLayerVisible,
  setZiplyPrintLayerVisible,
  ziply811OverlayVisible,
  setZiply811OverlayVisible
}: Props) {
  // Extract Ziply statuses (Not Started, In Progress, Complete)
  const ziplyStatuses = ["Not Started", "In Progress", "Complete"];
  
  // Calculate counts for each status
  const ziplyJobs = jobs.filter((j) => j.customerProject === "Ziply");
  
  const getStatusCount = (status: string) => {
    return ziplyJobs.filter((j) => {
      const s = j.jobStatus || "Not Started";
      if (status === "Not Started") return s === "Not Started" || s === "Needs Fielding" || s === "RTS";
      if (status === "In Progress") return s === "In Progress" || s === "Pending";
      return s === "Complete" || s === "Completed" || s === "All Construction Complete" || s === "Billing Complete";
    }).length;
  };

  const handleStatusToggle = (status: string) => {
    const nextBuckets = new Set(filters.buckets);
    
    // Map Ziply simple statuses to their underlying status buckets
    const bucketMapping: Record<string, string[]> = {
      "Not Started": ["needs_fielding", "rts", "on_hold"],
      "In Progress": ["pending", "in_progress"],
      "Complete": ["completed"]
    };

    const targetBuckets = bucketMapping[status] || [];
    
    // Check if any of these buckets are currently in the filter
    const hasAny = targetBuckets.some((b: any) => nextBuckets.has(b));

    if (hasAny) {
      targetBuckets.forEach((b: any) => nextBuckets.delete(b));
    } else {
      targetBuckets.forEach((b: any) => nextBuckets.add(b));
    }

    setFilters({
      ...filters,
      buckets: nextBuckets as any
    });
  };

  const isStatusChecked = (status: string) => {
    const bucketMapping: Record<string, string[]> = {
      "Not Started": ["needs_fielding", "rts", "on_hold"],
      "In Progress": ["pending", "in_progress"],
      "Complete": ["completed"]
    };
    const targetBuckets = bucketMapping[status] || [];
    return targetBuckets.some((b: any) => filters.buckets.has(b));
  };

  // Group Ziply FTTH jobs by site for the Sites Navigation
  const ftthJobs = ziplyJobs;

  const jobsBySite = new Map<string, Job[]>();
  ftthJobs.forEach(j => {
    const site = (j.city || "Unknown Site").trim();
    if (!jobsBySite.has(site)) jobsBySite.set(site, []);
    jobsBySite.get(site)!.push(j);
  });
  const sites = Array.from(jobsBySite.keys()).sort();
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
    const validJobs = siteJobs.filter(j => j.geocode?.status === "OK" && j.geocode.lat && j.geocode.lng);
    if (validJobs.length > 0) {
      const bounds = validJobs.map(j => ({ lat: j.geocode!.lat, lng: j.geocode!.lng }));
      window.dispatchEvent(new CustomEvent("nsc:pan-to", { detail: { bounds } }));
      setZiplyPrintLayerVisible(true);
    }
  };

  return (
    <div style={{ padding: 12, color: "#fff", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 1. Header / Stats Widget */}
      <div>
        <h3 style={{ margin: "0 0 4px 0", fontSize: 13, letterSpacing: "0.05em", color: "#00E676" }}>
          ZIPLY FILTERS
        </h3>
        <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>
          Showing {ziplyJobs.filter(j => {
            const b = (j.jobStatus || "").toLowerCase();
            return filters.buckets.has("completed") ? true : !b.includes("complete");
          }).length} of {ziplyJobs.length} active jobs
        </p>
      </div>

      {/* 2. Map Design Layer Toggle */}
      <div style={{ padding: 8, background: "rgba(0,230,118,0.06)", border: "1px solid rgba(0,230,118,0.15)", borderRadius: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
          <input
            type="checkbox"
            checked={ziplyPrintLayerVisible}
            onChange={(e) => setZiplyPrintLayerVisible(e.target.checked)}
            style={{ accentColor: "#00E676" }}
          />
          <span>🛰️ SHOW PRINT DESIGN LAYER</span>
        </label>
        <p style={{ margin: "4px 0 0 20px", fontSize: 9, color: "#9ca3af" }}>
          Overlay FDH cabinets, MSTs, and drop counts directly on the map.
        </p>
      </div>

      <div style={{ padding: 8, background: "rgba(250,204,21,0.07)", border: "1px solid rgba(250,204,21,0.22)", borderRadius: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
          <input
            type="checkbox"
            checked={ziply811OverlayVisible}
            onChange={(e) => setZiply811OverlayVisible(e.target.checked)}
            style={{ accentColor: "#FACC15" }}
          />
          <span style={{ color: "#FACC15" }}>811 CLEARED / NOT CLEARED BY SECTION</span>
        </label>
        <p style={{ margin: "4px 0 0 20px", fontSize: 9, color: "#9ca3af" }}>
          Recolors terminals and section paths by active locate coverage, separate from build progress.
        </p>
      </div>

      {/* 3. Job Status Checklist */}
      <div>
        <span style={{ display: "block", fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", color: "#9ca3af", letterSpacing: "0.05em" }}>
          Status
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ziplyStatuses.map((status) => (
            <label
              key={status}
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
                  checked={isStatusChecked(status)}
                  onChange={() => handleStatusToggle(status)}
                  style={{ accentColor: "#00E676" }}
                />
                <span>{status}</span>
              </div>
              <span style={{ fontSize: 10, color: "#6b7280" }}>{getStatusCount(status)}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 4. Sites Navigation */}
      <div>
        <span style={{ display: "block", fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", color: "#9ca3af", letterSpacing: "0.05em" }}>
          Sites Navigation
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sites.map((site) => {
            const isExpanded = expandedSites.has(site);
            const siteJobs = jobsBySite.get(site)!;
            return (
              <div key={site} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div 
                  onClick={() => toggleSite(site)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "6px 8px", background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, cursor: "pointer"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {isExpanded ? <ChevronDown size={14} color="#9ca3af" /> : <ChevronRight size={14} color="#9ca3af" />}
                    <span style={{ fontSize: 11, fontWeight: 600 }}>{site}</span>
                  </div>
                  <button 
                    onClick={(e) => handlePanToSite(site, e)}
                    style={{ background: "var(--accent, #4facfe)", border: "none", borderRadius: 12, color: "#000", fontSize: 9, fontWeight: 800, padding: "2px 8px", cursor: "pointer" }}
                  >
                    GO TO SITE
                  </button>
                </div>
                {isExpanded && (
                  <div style={{ paddingLeft: 24, marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                    {siteJobs.map(job => (
                      <div 
                        key={job.jobId} 
                        style={{ fontSize: 10, color: "#cbd5e1", display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: 2 }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
                          {job.address || job.workOrder}
                        </span>
                        <span style={{ color: job.jobStatus === "Complete" ? "#00E676" : "#4facfe" }}>
                          {job.jobStatus || "Not Started"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. Extra Options & 811 */}
      <div>
        <span style={{ display: "block", fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", color: "#9ca3af", letterSpacing: "0.05em" }}>
          Options
        </span>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, cursor: "pointer", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={filters.hideUnmapped}
            onChange={(e) => setFilters({ ...filters, hideUnmapped: e.target.checked })}
            style={{ accentColor: "#00E676" }}
          />
          <span>Hide Unmapped Jobs</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, cursor: "pointer", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={filters.inTrackerOnly}
            onChange={(e) => setFilters({ ...filters, inTrackerOnly: e.target.checked })}
            style={{ accentColor: "#00E676" }}
          />
          <span>On Tracker Only</span>
        </label>
        
        {/* 811 Toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, cursor: "pointer", marginTop: 8, padding: "6px 8px", background: "rgba(250, 204, 21, 0.1)", border: "1px solid rgba(250, 204, 21, 0.3)", borderRadius: 4 }}>
          <input
            type="checkbox"
            checked={filters.showDigPolygons ?? true}
            onChange={(e) => setFilters({ ...filters, showDigPolygons: e.target.checked })}
            style={{ accentColor: "#FACC15" }}
          />
          <span style={{ color: "#FACC15", fontWeight: 700 }}>SHOW 811 DIG TICKETS</span>
        </label>
      </div>
    </div>
  );
}
