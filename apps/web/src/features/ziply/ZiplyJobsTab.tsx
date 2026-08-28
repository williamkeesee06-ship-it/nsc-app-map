import { useMemo, useState, useEffect } from "react";
import type { Job } from "@nsc/types";
import { Map as MapIcon, Grid, Search } from "lucide-react";
import "./ziplyJobsTab.css";
import {
  isNorthMetroJob,
  ziplyStatusGroupForJob,
} from "./ziplyUtils.js";

interface Props {
  jobs: Job[];
  selected?: Job | null;
  setSelected?: (job: Job | null) => void;
  onClose?: () => void;
}

type RegionFilter = "all" | "north_metro";

export default function ZiplyJobsTab({ jobs, selected, setSelected, onClose }: Props) {
  // Only jobs currently on Ziply's tracker — sync marks removed rows as
  // inTracker:false so they don't inflate counts here.
  const ziplyJobs = useMemo(
    () => jobs.filter((j) => j.customerProject === "Ziply" && j.inTracker !== false),
    [jobs]
  );

  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    selected?.jobId || null
  );
  const [query, setQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState<RegionFilter>("all");

  useEffect(() => {
    if (selected) setSelectedJobId(selected.jobId);
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ziplyJobs
      .filter((j) => {
        if (regionFilter === "north_metro" && !isNorthMetroJob(j)) return false;
        if (!q) return true;
        const hay = [
          j.workOrder,
          j.hubNumber,
          j.city,
          j.address,
          j.sapSalesOrder,
          j.sapContractId,
          j.nscProjectNotes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.workOrder || "").localeCompare(b.workOrder || ""));
  }, [ziplyJobs, query, regionFilter]);

  const northCount = useMemo(
    () => ziplyJobs.filter(isNorthMetroJob).length,
    [ziplyJobs]
  );

  return (
    <div className="ziply-jobs-tab-fullscreen">
      <div className="ss-header">
        <h2>
          <Grid size={20} color="#1e5eff" />
          Ziply FTTH Jobs
        </h2>
        <div className="ss-header-meta">
          <span>
            {filtered.length} shown · {ziplyJobs.length} total · {northCount} North Metro
          </span>
          {onClose && (
            <button className="close-btn" onClick={onClose} title="Close tracker">
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="ss-toolbar ss-toolbar--filters">
        <div className="ss-search">
          <Search size={14} />
          <input
            type="search"
            placeholder="Search WO, hub, city, SAP…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value as RegionFilter)}
          title="Region"
        >
          <option value="all">All regions</option>
          <option value="north_metro">North Metro only</option>
        </select>
      </div>

      <div className="ss-table-container">
        <table className="ss-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th style={{ width: 100 }}>Work Order</th>
              <th style={{ width: 90 }}>Hub</th>
              <th style={{ width: 110 }}>City</th>
              <th style={{ width: 90 }}>Region</th>
              <th style={{ width: 120 }}>Job Status</th>
              <th style={{ width: 120 }}>Progress</th>
              <th style={{ width: 100 }}>SAP SO</th>
              <th style={{ width: 100 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: 24, color: "#64748b" }}>
                  No Ziply jobs match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((job, index) => {
                const isSelected = job.jobId === selectedJobId;
                const north = isNorthMetroJob(job);
                const progress = ziplyStatusGroupForJob(job);

                return (
                  <tr
                    key={job.jobId}
                    className={isSelected ? "selected" : ""}
                    onClick={() => setSelectedJobId(job.jobId)}
                  >
                    <td style={{ textAlign: "center", color: "#94a3b8" }}>
                      {index + 1}
                    </td>
                    <td style={{ fontWeight: 600 }}>{job.workOrder}</td>
                    <td>{job.hubNumber || "—"}</td>
                    <td>{job.city || "—"}</td>
                    <td>
                      {north ? (
                        <span className="ss-pill ss-pill--metro">North Metro</span>
                      ) : (
                        <span className="ss-muted">Other</span>
                      )}
                    </td>
                    <td>{job.jobStatus || "—"}</td>
                    <td>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: progress === "complete" ? "#1d4ed8" : progress === "in_progress" ? "#06b6d4" : "#64748b",
                      }}>
                        {progress === "complete" ? "Complete" : progress === "in_progress" ? "In Progress" : "Not Started"}
                      </span>
                    </td>
                    <td>{job.sapSalesOrder || "—"}</td>
                    <td>
                      <div className="ss-actions">
                        <button
                          type="button"
                          className="ss-btn-map"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (setSelected) setSelected(job);
                            // Fly the map to this job's geocode. Uses the same
                            // proven bus event JobsMapInner already listens to
                            // (see the Ziply focus effect in JobsMap.tsx).
                            const g = job.geocode;
                            if (g?.status === "OK" && g.lat && g.lng) {
                              window.dispatchEvent(
                                new CustomEvent("nsc:pan-to", {
                                  detail: { lat: g.lat, lng: g.lng, zoom: 17 },
                                })
                              );
                            }
                            if (onClose) onClose();
                          }}
                        >
                          <MapIcon size={12} /> Map
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
