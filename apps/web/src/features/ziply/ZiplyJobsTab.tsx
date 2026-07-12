import { useMemo, useRef, useState, useEffect } from "react";
import type { Job } from "@nsc/types";
import { Map as MapIcon, Paperclip, Grid, Search } from "lucide-react";
import "./ziplyJobsTab.css";
import { api } from "../../lib/api.js";
import {
  formatBytes,
  getCadFidelity,
  getZiplyPrintDocStatus,
  ingestZiplyPrintForJob,
  isNorthMetroJob,
  listZiplyPrintFiles,
  ziplyPrintStatusColor,
  ziplyPrintStatusLabel,
  type ZiplyPrintDocStatus,
} from "./ziplyUtils.js";

interface Props {
  jobs: Job[];
  selected?: Job | null;
  setSelected?: (job: Job | null) => void;
  onClose?: () => void;
}

type PrintFilter = "all" | ZiplyPrintDocStatus;
type RegionFilter = "all" | "north_metro";

export default function ZiplyJobsTab({ jobs, selected, setSelected, onClose }: Props) {
  const ziplyJobs = useMemo(
    () => jobs.filter((j) => j.customerProject === "Ziply"),
    [jobs]
  );

  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    selected?.jobId || null
  );
  const [query, setQuery] = useState("");
  const [printFilter, setPrintFilter] = useState<PrintFilter>("all");
  const [regionFilter, setRegionFilter] = useState<RegionFilter>("all");
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fleetBusy, setFleetBusy] = useState(false);
  const [fleetMsg, setFleetMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (selected) setSelectedJobId(selected.jobId);
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ziplyJobs
      .filter((j) => {
        if (regionFilter === "north_metro" && !isNorthMetroJob(j)) return false;
        if (printFilter !== "all" && getZiplyPrintDocStatus(j) !== printFilter) {
          return false;
        }
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
  }, [ziplyJobs, query, printFilter, regionFilter]);

  const counts = useMemo(() => {
    const c = { ready: 0, processing: 0, failed: 0, none: 0, north: 0 };
    for (const j of ziplyJobs) {
      c[getZiplyPrintDocStatus(j)]++;
      if (isNorthMetroJob(j)) c.north++;
    }
    return c;
  }, [ziplyJobs]);

  const startUpload = (jobId: string) => {
    uploadTargetRef.current = jobId;
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const jobId = uploadTargetRef.current;
    e.target.value = "";
    if (!file || !jobId) return;
    setUploadingId(jobId);
    setUploadPct(0);
    setUploadError(null);
    try {
      await ingestZiplyPrintForJob(jobId, file, (p) => setUploadPct(Math.round(p)));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingId(null);
      setUploadPct(0);
      uploadTargetRef.current = null;
    }
  };

  return (
    <div className="ziply-jobs-tab-fullscreen">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*"
        style={{ display: "none" }}
        onChange={(ev) => void onFileChosen(ev)}
      />

      <div className="ss-header">
        <h2>
          <Grid size={20} color="#1e5eff" />
          Ziply FTTH Jobs
        </h2>
        <div className="ss-header-meta">
          <span>
            {filtered.length} shown · {ziplyJobs.length} total · {counts.ready}{" "}
            prints on map · {counts.north} North Metro
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
        <select
          value={printFilter}
          onChange={(e) => setPrintFilter(e.target.value as PrintFilter)}
          title="Print document"
        >
          <option value="all">All print states</option>
          <option value="ready">Print on map ({counts.ready})</option>
          <option value="processing">Ingesting ({counts.processing})</option>
          <option value="none">No print ({counts.none})</option>
          <option value="failed">Failed ({counts.failed})</option>
        </select>
        <button
          type="button"
          disabled={fleetBusy}
          className="ss-action-btn"
          title="Rebuild plant CAD for stale/synthetic prints (batch)"
          onClick={() => {
            setFleetBusy(true);
            setFleetMsg(null);
            void api
              .enhanceAllZiplyPrints({ limit: 20, onlyStale: true })
              .then((r) => {
                setFleetMsg(
                  `Batch CAD: ${r.enhanced} enhanced · ${r.failed} failed · ${r.attempted} attempted`
                );
                window.dispatchEvent(new Event("nsc:jobs-reload"));
              })
              .catch((e) =>
                setFleetMsg(e instanceof Error ? e.message : "Batch enhance failed")
              )
              .finally(() => setFleetBusy(false));
          }}
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid rgba(56,189,248,0.5)",
            background: "rgba(56,189,248,0.12)",
            color: "#38bdf8",
            cursor: fleetBusy ? "wait" : "pointer",
          }}
        >
          {fleetBusy ? "Rebuilding CAD…" : "Batch rebuild CAD"}
        </button>
        <button
          type="button"
          disabled={fleetBusy}
          title="Fleet CAD fidelity QA report"
          onClick={() => {
            setFleetBusy(true);
            setFleetMsg(null);
            void api
              .ziplyFidelityReport()
              .then((r) => {
                const g = r.byGrade;
                setFleetMsg(
                  `Fidelity: ${r.totalPrintJobs} prints · A${g.A ?? 0} B${g.B ?? 0} C${g.C ?? 0} D${g.D ?? 0} F${g.F ?? 0}` +
                    (r.avgResidualM != null
                      ? ` · avg ±${Math.round(r.avgResidualM)}m`
                      : "")
                );
              })
              .catch((e) =>
                setFleetMsg(e instanceof Error ? e.message : "Fidelity report failed")
              )
              .finally(() => setFleetBusy(false));
          }}
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid rgba(30, 94, 255,0.45)",
            background: "rgba(30, 94, 255,0.1)",
            color: "#1d4ed8",
            cursor: fleetBusy ? "wait" : "pointer",
          }}
        >
          Fidelity report
        </button>
        {uploadError && <span className="ss-upload-error">{uploadError}</span>}
        {fleetMsg && (
          <span style={{ fontSize: 11, color: "#67e8f9", maxWidth: 420 }}>{fleetMsg}</span>
        )}
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
              <th style={{ width: 130 }}>Print document</th>
              <th style={{ width: 90 }}>CAD grade</th>
              <th style={{ width: 160 }}>Uploaded files</th>
              <th style={{ width: 100 }}>SAP SO</th>
              <th style={{ width: 160 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: "center", padding: 24, color: "#64748b" }}>
                  No Ziply jobs match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((job, index) => {
                const isSelected = job.jobId === selectedJobId;
                const pst = getZiplyPrintDocStatus(job);
                const files = listZiplyPrintFiles(job);
                const north = isNorthMetroJob(job);
                const busy = uploadingId === job.jobId;
                const cad = getCadFidelity(job);

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
                      <span
                        className="ss-print-status"
                        style={{ color: ziplyPrintStatusColor(pst) }}
                      >
                        ● {ziplyPrintStatusLabel(pst)}
                      </span>
                      {busy && (
                        <div className="ss-upload-progress">Uploading {uploadPct}%</div>
                      )}
                    </td>
                    <td>
                      {pst === "ready" ? (
                        <span style={{ fontWeight: 800, color: cad.color, fontSize: 11 }}>
                          {cad.label}
                        </span>
                      ) : (
                        <span className="ss-muted">—</span>
                      )}
                    </td>
                    <td>
                      {files.length === 0 ? (
                        <span className="ss-muted">None</span>
                      ) : (
                        <div className="ss-file-list">
                          {files.map((f, i) =>
                            f.downloadUrl ? (
                              <a
                                key={i}
                                href={f.downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(ev) => ev.stopPropagation()}
                                title={f.name}
                              >
                                {f.name}
                                {f.size != null ? ` (${formatBytes(f.size)})` : ""}
                              </a>
                            ) : (
                              <span key={i} title={f.name}>
                                {f.name}
                              </span>
                            )
                          )}
                        </div>
                      )}
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
                            if (onClose) onClose();
                          }}
                        >
                          <MapIcon size={12} /> Map
                        </button>
                        <button
                          type="button"
                          className="ss-btn-attach"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            startUpload(job.jobId);
                          }}
                          title="Upload engineering print PDF/image for this job"
                        >
                          <Paperclip size={12} />
                          {busy ? `${uploadPct}%` : "Print"}
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
