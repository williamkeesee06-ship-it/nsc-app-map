import { useState } from "react";
import type { Job } from "@nsc/types";
import type { Filters } from "./FilterRail.js";

interface Props {
  jobs: Job[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  // Extra fields we add for Ziply
  ziplyPrintLayerVisible: boolean;
  setZiplyPrintLayerVisible: (v: boolean) => void;
}

export default function ZiplyFilterPanel({
  jobs,
  filters,
  setFilters,
  ziplyPrintLayerVisible,
  setZiplyPrintLayerVisible
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

      {/* 4. Extra Options */}
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
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={filters.inTrackerOnly}
            onChange={(e) => setFilters({ ...filters, inTrackerOnly: e.target.checked })}
            style={{ accentColor: "#00E676" }}
          />
          <span>On Tracker Only</span>
        </label>
      </div>
    </div>
  );
}
