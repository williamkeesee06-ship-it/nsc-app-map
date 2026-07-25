// Compact job card with unified styling (Lumen & Ziply) and collapsible sections.
import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, ChevronRight, ChevronDown, CheckCircle2, Wand2, Calendar, FileDown, UploadCloud, Layers, Paperclip } from "lucide-react";
import { useMap } from "@vis.gl/react-google-maps";
import type { DigTicket, Job } from "@nsc/types";
import { Link } from "react-router-dom";
import { MARKER_COLORS, colorKeyForSecondaryStatus } from "./markerStyle.js";
import { api } from "../../lib/api.js";
import { useAuth } from "../auth/authContext.js";
import Eight11Section from "./Eight11Section.js";
import { computePlantProgress, isZiplyJob } from "../ziply/ziplyUtils.js";
import LayersPanel from "../workspace/LayersPanel.js";
import { useActiveContract } from "../workspace/contractStore.js";

interface Props {
  job: Job;
  onClose?: () => void;
  variant?: "popup" | "panel";
  theme?: "steel" | "cyberpunk" | "titanium" | "glass";
  onThemeChange?: (theme: "steel" | "cyberpunk" | "titanium" | "glass") => void;
}

interface Schema {
  secondaryStatusOptions: string[];
  foremanOptions: string[];
}

let _schemaCache: Schema | null = null;
let _schemaPromise: Promise<Schema> | null = null;

const SS_WORKER = "https://nsc-smartapp.williamkeesee06.workers.dev";

function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function loadSchema(): Promise<Schema> {
  if (_schemaCache) return Promise.resolve(_schemaCache);
  if (_schemaPromise) return _schemaPromise;
  _schemaPromise = fetch(`${SS_WORKER}/schema`)
    .then((r) => r.json())
    .then((d) => {
      const c: Schema = {
        secondaryStatusOptions: d.secondaryStatusOptions || [],
        foremanOptions: d.foremanOptions || [],
      };
      _schemaCache = c;
      return c;
    })
    .catch((err) => {
      console.warn("[JobCard] Failed to fetch Smartsheet schema options, will retry on next interaction:", err);
      _schemaPromise = null;
      return { secondaryStatusOptions: [], foremanOptions: [] };
    });
  return _schemaPromise;
}

async function saveField(
  wo: string,
  field: string,
  value: string | boolean | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${SS_WORKER}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wo, fields: { [field]: value } }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) return { ok: false, error: d.error || `HTTP ${r.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export default function JobCard({
  job,
  onClose,
  variant = "popup",
  theme = "steel",
  onThemeChange,
}: Props) {
  const { username, isManager } = useAuth();
  const [minimized, setMinimized] = useState(false);
  const [localTheme, setLocalTheme] = useState<"steel" | "cyberpunk" | "titanium" | "glass">("steel");
  const activeTheme = onThemeChange ? theme : localTheme;
  const setActiveTheme = onThemeChange ? onThemeChange : setLocalTheme;
  const wo = job.workOrder;
  const status = job.jobStatus ?? "—";

  const [activeTab, setActiveTab] = useState<"info" | "progress" | "overlays">("info");
  const [docsExpanded, setDocsExpanded] = useState(false);
  const { contract } = useActiveContract();

  // Collapse/Expand state
  const [notesExpanded, setNotesExpanded] = useState(false);

  // Local edit state (optimistic display until save resolves)
  const [secondary, setSecondary] = useState<string>(job.secondaryJobStatus ?? "");
  const [foreman, setForeman] = useState<string>(job.constructionCrewForeman ?? "");
  const [schedDate, setSchedDate] = useState<string>(job.scheduleDate ?? "");
  const [tcReq, setTcReq] = useState<boolean | null>(
    typeof job.trafficControlRequired === "boolean" ? job.trafficControlRequired : null,
  );
  const [notes, setNotes] = useState<string>(job.nscProjectNotes ?? "");

  const [schema, setSchema] = useState<Schema | null>(_schemaCache);
  useEffect(() => {
    if (!schema) loadSchema().then((s) => setSchema(s));
  }, [schema]);

  // Re-sync local state if the underlying job object changes
  useEffect(() => {
    setSecondary(job.secondaryJobStatus ?? "");
    setForeman(job.constructionCrewForeman ?? "");
    setSchedDate(job.scheduleDate ?? "");
    setTcReq(typeof job.trafficControlRequired === "boolean" ? job.trafficControlRequired : null);
    setNotes(job.nscProjectNotes ?? "");
  }, [job.jobId]);

  // Save indicator state
  const [savingField, setSavingField] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [errField, setErrField] = useState<string | null>(null);

  async function commit(field: string, value: string | boolean | null) {
    setSavingField(field);
    setErrField(null);
    setSavedField(null);
    const res = await saveField(wo, field, value);
    setSavingField(null);
    if (res.ok) {
      setSavedField(field);
      setTimeout(() => setSavedField(null), 1500);
      try {
        if (username) {
          if (isManager) {
            await api.syncAllSupervisors(username);
          } else {
            await api.syncSupervisor(username);
          }
          window.dispatchEvent(new Event("nsc:jobs-reload"));
        }
      } catch (err) {
        console.warn("Post-save sync failed:", err);
      }
    } else {
      setErrField(field);
      console.error("Smartsheet save failed", field, res.error);
      setTimeout(() => setErrField(null), 4000);
    }
  }

  if (minimized && variant === "popup") {
    return (
      <div className="job-card-pill" title={`${wo} · ${status}`}>
        <span className="job-card-pill__wo">{wo}</span>
        <button
          className="job-card-pill__restore icon-btn"
          onClick={() => setMinimized(false)}
          aria-label="Restore job card"
          title="Restore"
        >
          ↕
        </button>
        {onClose && (
          <button
            className="job-card-pill__close icon-btn"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  const secondaryOptions = schema?.secondaryStatusOptions ?? [];
  const foremanOptions = schema?.foremanOptions ?? [];

  // Documents listing: Ziply documents + permits
  const ziplyPrintLayer = job.ziplyPrintLayer;
  const attachmentsList = ziplyPrintLayer?.permitFiles ?? [];

  // Plant stats / Running totals
  const stats = computePlantProgress(job);

  const overlayPages = job.printOverlay?.pages ?? [];
  const [activePageSelId, setActivePageSelId] = useState<string>("");

  useEffect(() => {
    if (overlayPages.length > 0 && !activePageSelId) {
      setActivePageSelId(overlayPages[0].id);
    }
  }, [overlayPages, activePageSelId]);

  const activePageSel = overlayPages.find(p => p.id === activePageSelId);
  const activePageOpacity = activePageSel ? (job.printOverlay?.transforms?.[activePageSel.id]?.opacity ?? 0.5) : 0.5;

  const togglePageExcluded = async (pageId: string) => {
    if (!job.printOverlay) return;
    const doc = { ...job.printOverlay };
    doc.pages = doc.pages.map((p) =>
      p.id === pageId ? { ...p, excluded: !p.excluded } : p
    );
    doc.updatedAt = Date.now();
    doc.updatedBy = username || "system";

    job.printOverlay = doc;
    window.dispatchEvent(new Event("nsc:jobs-reload"));

    try {
      await api.putPrintOverlay(job.jobId, doc);
    } catch (e) {
      console.warn("[JobCard] Failed to toggle page visibility", e);
    }
  };

  const updatePageOpacity = async (pageId: string, opacity: number) => {
    if (!job.printOverlay) return;
    const doc = { ...job.printOverlay };
    const transforms = { ...doc.transforms };
    const base = transforms[pageId] ?? {
      center: job.geocode ? { lat: job.geocode.lat, lng: job.geocode.lng } : { lat: 0, lng: 0 },
      scale: 1,
      rotationDeg: 0,
      opacity: 0.5
    };
    transforms[pageId] = { ...base, opacity };
    doc.transforms = transforms;
    doc.updatedAt = Date.now();
    doc.updatedBy = username || "system";

    job.printOverlay = doc;
    window.dispatchEvent(new Event("nsc:jobs-reload"));

    try {
      await api.putPrintOverlay(job.jobId, doc);
    } catch (e) {
      console.warn("[JobCard] Failed to update page opacity", e);
    }
  };

  const getStatusStyles = (statusStr: string) => {
    const s = statusStr.toLowerCase();
    if (s.includes("ready") || s.includes("rts") || s.includes("clear")) {
      return { border: "1.5px solid #00C853", boxShadow: "0 0 8px rgba(0, 200, 83, 0.25)", backgroundColor: "rgba(0, 200, 83, 0.05)", color: "#00C853" };
    } else if (s.includes("progress") || s.includes("active") || s.includes("sched") || s.includes("route")) {
      return { border: "1.5px solid #0033A0", boxShadow: "0 0 8px rgba(0, 51, 160, 0.25)", backgroundColor: "rgba(0, 51, 160, 0.05)", color: "#0033A0" };
    } else if (s.includes("pending")) {
      return { border: "1.5px solid #ff8a1f", boxShadow: "0 0 8px rgba(255, 138, 31, 0.25)", backgroundColor: "rgba(255, 138, 31, 0.05)", color: "#ff8a1f" };
    } else if (s.includes("complete") || s.includes("done")) {
      return { border: "1.5px solid #00C853", boxShadow: "0 0 8px rgba(0, 200, 83, 0.25)", backgroundColor: "rgba(0, 200, 83, 0.05)", color: "#00C853" };
    } else if (s.includes("hold")) {
      return { border: "1.5px solid #ff2d4a", boxShadow: "0 0 8px rgba(255, 45, 74, 0.25)", backgroundColor: "rgba(255, 45, 74, 0.05)", color: "#ff2d4a" };
    } else if (s.includes("fielding")) {
      return { border: "1.5px solid #c44dff", boxShadow: "0 0 8px rgba(196, 77, 255, 0.25)", backgroundColor: "rgba(196, 77, 255, 0.05)", color: "#c44dff" };
    } else {
      return { border: "1.5px solid #94a3b8", boxShadow: "0 0 8px rgba(148, 163, 184, 0.25)", backgroundColor: "rgba(148, 163, 184, 0.05)", color: "#94a3b8" };
    }
  };

  const isPanel = variant === "panel";

  if (!isPanel) {
    return (
      <div className={`job-card job-card--popup theme-${activeTheme}`} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px", width: "280px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "14px", fontWeight: 900, color: "#0033A0" }}>{wo}</span>
          <span style={{
            fontSize: "9px",
            fontWeight: 800,
            padding: "2px 6px",
            borderRadius: "9999px",
            ...getStatusStyles(secondary || status)
          }}>
            {secondary || status}
          </span>
        </header>
        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          <div>{job.address}</div>
          <div>{job.city}</div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="job-detail-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "transparent",
        overflow: "hidden"
      }}
    >
      {/* Header Info: Job Number & Status Pill */}
      <div style={{ padding: "18px 20px 12px 20px", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{
            fontSize: "26px",
            fontWeight: 900,
            color: "#0033A0",
            fontFamily: "'Space Grotesk', 'Rajdhani', sans-serif",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            textShadow: "0 0 1px rgba(0, 51, 160, 0.05)"
          }}>
            {wo}
          </div>
          {onClose && (
            <button 
              onClick={onClose} 
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "18px",
                padding: "4px",
                lineHeight: 1,
                transition: "color 0.2s"
              }}
              onMouseOver={(e) => e.currentTarget.style.color = "var(--text)"}
              onMouseOut={(e) => e.currentTarget.style.color = "var(--text-muted)"}
            >
              ×
            </button>
          )}
        </div>

        {/* Status and other pills row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
          <div style={{
            display: "inline-block",
            borderRadius: "9999px",
            padding: "3px 10px",
            fontSize: "9px",
            fontWeight: 800,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            ...getStatusStyles(secondary || status)
          }}>
            {secondary || status}
          </div>
          
          {!job.inTracker && (
            <span style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1.5px solid #ef4444",
              color: "#ef4444",
              borderRadius: "9999px",
              padding: "2px 8px",
              fontSize: "8px",
              fontWeight: 800,
              textTransform: "uppercase"
            }}>
              Archived
            </span>
          )}
          <Eight11ExpiryPill job={job} />
        </div>
      </div>

      {/* Royal Blue Glow Tabstrip */}
      <div style={{
        display: "flex",
        padding: "0 20px 8px 20px",
        gap: 6,
        borderBottom: "1.5px solid var(--border)",
        flexShrink: 0
      }}>
        {(["info", "progress", "overlays"] as const).map(tab => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                background: isActive ? "rgba(0, 51, 160, 0.08)" : "transparent",
                border: isActive ? "1.5px solid #0033A0" : "1.5px solid transparent",
                color: isActive ? "#0033A0" : "var(--text-muted)",
                fontSize: "10px",
                fontWeight: 900,
                textTransform: "uppercase",
                padding: "8px 4px",
                borderRadius: "8px",
                cursor: "pointer",
                textAlign: "center",
                boxShadow: isActive ? "0 2px 6px rgba(0, 51, 160, 0.15)" : "none",
                transition: "all 0.2s ease-in-out",
                letterSpacing: "0.05em"
              }}
              onMouseOver={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = "#0033A0";
                  e.currentTarget.style.borderColor = "rgba(0, 51, 160, 0.2)";
                }
              }}
              onMouseOut={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "transparent";
                }
              }}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Tab Content Section (Scrollable) */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        
        {/* INFO TAB */}
        {activeTab === "info" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Row label="Address" value={job.address} />
              <Row label="City" value={job.city} />
              <Row label="Supervisor" value={job.constructionSupervisor || "Unassigned"} />
            </div>

            <div style={{ height: 0, borderTop: "1px solid #cbd5e1", borderBottom: "1px solid #ffffff", margin: "14px 0 12px 0" }} />

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  NSC Project Notes
                </span>
                <SaveIndicator
                  saving={savingField === "notes"}
                  saved={savedField === "notes"}
                  error={errField === "notes"}
                />
              </div>
              <EditableNotes value={notes} onCommit={(v) => { setNotes(v); void commit("notes", v); }} />
            </div>
          </>
        )}

        {/* PROGRESS TAB */}
        {activeTab === "progress" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <EditableRow
                label="Crew / Foreman"
                value={foreman}
                type="select"
                options={foremanOptions}
                onChange={(v) => {
                  setForeman(v);
                  void commit("foreman", v);
                }}
                saving={savingField === "foreman"}
                saved={savedField === "foreman"}
                error={errField === "foreman"}
              />

              <EditableRow
                label="Schedule Date"
                value={schedDate}
                type="date"
                onChange={(v) => {
                  setSchedDate(v);
                  void commit("schedDate", v || null);
                }}
                saving={savingField === "schedDate"}
                saved={savedField === "schedDate"}
                error={errField === "schedDate"}
              />

              <EditableRow
                label="Traffic Control"
                value={tcReq === true ? "Required" : tcReq === false ? "Not required" : ""}
                type="toggle"
                toggleValue={tcReq === true}
                onToggle={(v) => {
                  setTcReq(v);
                  void commit("tcRequired", v);
                }}
                saving={savingField === "tcRequired"}
                saved={savedField === "tcRequired"}
                error={errField === "tcRequired"}
              />
            </div>

            {/* Construction Progress (Bore/Terminal progress bars) */}
            {isZiplyJob(job) && (
              <>
                <div style={{ height: 0, borderTop: "1px solid #cbd5e1", borderBottom: "1px solid #ffffff", margin: "14px 0 12px 0" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Ziply Construction Progress
                  </span>
                  
                  <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", padding: 10, borderRadius: 8, display: "flex", flexDirection: "column", gap: 8, boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)" }}>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4 }}>
                        <span style={{ color: "var(--text-muted)" }}>Bore Complete:</span>
                        <span style={{ fontWeight: 800, color: "var(--text)" }}>{stats.completeFt} ft / {stats.totalFt} ft</span>
                      </div>
                      <div style={{ width: "100%", height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${stats.totalFt > 0 ? (stats.completeFt / stats.totalFt) * 100 : 0}%`, height: "100%", background: "#0033A0" }} />
                      </div>
                    </div>
                    
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4 }}>
                        <span style={{ color: "var(--text-muted)" }}>Splice Terminals Complete:</span>
                        <span style={{ fontWeight: 800, color: "var(--text)" }}>{stats.complete} / {stats.total}</span>
                      </div>
                      <div style={{ width: "100%", height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${stats.total > 0 ? (stats.complete / stats.total) * 100 : 0}%`, height: "100%", background: "#0033A0" }} />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* 811 Locate Section inside Tab */}
            <div style={{ height: 0, borderTop: "1px solid #cbd5e1", borderBottom: "1px solid #ffffff", margin: "14px 0 12px 0" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <h4 style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", margin: "0 0 2px 0", letterSpacing: "0.05em" }}>
                811 Locate Shape
              </h4>
              <Eight11Section job={job} />
            </div>
          </>
        )}

        {/* OVERLAYS TAB */}
        {activeTab === "overlays" && (
          <>
            {/* If Ziply: Print Anchoring controls */}
            {isZiplyJob(job) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <h4 style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", margin: 0, letterSpacing: "0.05em" }}>
                  Print Anchoring
                </h4>
                
                {!ziplyPrintLayer?.mapObjects ? (
                  <div style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        border: "1.5px solid #002280",
                        background: "#0033A0",
                        color: "#ffffff",
                        boxShadow: "0 2px 6px rgba(0, 51, 160, 0.2)",
                        borderRadius: "8px",
                        padding: "8px",
                        fontSize: "11px",
                        fontWeight: 800,
                        letterSpacing: "0.05em",
                        cursor: "pointer",
                      }}
                      onClick={() => window.open(`/print-overlay/jobs/${job.jobId}`, "_blank")}
                    >
                      <Layers size={12} /> PRINT OVERLAY
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Active page opacity slider */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "var(--text-muted)", fontSize: "9px", fontWeight: 700, textTransform: "uppercase" }}>Opacity:</span>
                        <select
                          value={activePageSelId}
                          onChange={(e) => setActivePageSelId(e.target.value)}
                          style={{
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            color: "var(--text)",
                            fontSize: 9,
                            padding: "1px 4px",
                            borderRadius: 4,
                            outline: "none"
                          }}
                        >
                          {overlayPages.map(p => (
                            <option key={p.id} value={p.id}>Page {p.pageNumber}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={activePageOpacity}
                          onChange={(e) => {
                            if (activePageSelId) {
                              void updatePageOpacity(activePageSelId, parseFloat(e.target.value));
                            }
                          }}
                          style={{ flexGrow: 1, height: 4, accentColor: "#0033A0" }}
                        />
                        <span style={{ fontSize: 9, color: "#0033A0", fontWeight: 800, width: 26, textAlign: "right" }}>
                          {Math.round(activePageOpacity * 100)}%
                        </span>
                      </div>
                    </div>

                    {/* Page toggles list */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                      <span style={{ color: "var(--text-muted)", fontSize: "9px", fontWeight: 700, textTransform: "uppercase" }}>Toggles:</span>
                      {overlayPages.map((p) => (
                        <label key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10px", color: p.excluded ? "var(--text-muted)" : "var(--text)", cursor: "pointer" }}>
                          <span>{p.label}</span>
                          <input
                            type="checkbox"
                            checked={!p.excluded}
                            onChange={() => void togglePageExcluded(p.id)}
                            style={{ accentColor: "#0033A0" }}
                          />
                        </label>
                      ))}
                    </div>

                    <div style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        style={{
                          width: "100%",
                          border: "1px solid #c7cdd5",
                          background: "#ffffff",
                          color: "#475569",
                          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                          borderRadius: "6px",
                          padding: "5px",
                          fontSize: "9px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                        onClick={() => window.open(`/print-overlay/jobs/${job.jobId}`, "_blank")}
                      >
                        Adjust Aligned Sheets ↗
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* If Lumen (non-Ziply): Render LayersPanel */}
            {contract !== "Ziply" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <h4 style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", margin: 0, letterSpacing: "0.05em" }}>
                  Drawing Layers
                </h4>
                <LayersPanel />
              </div>
            )}
          </>
        )}

      </div>

      {/* Bottom Documents/Attachments Section */}
      <div style={{
        borderTop: "1.5px solid var(--border)",
        background: "rgba(15, 23, 42, 0.02)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0
      }}>
        <button
          type="button"
          onClick={() => setDocsExpanded(!docsExpanded)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "none",
            border: "none",
            width: "100%",
            padding: "12px 20px",
            cursor: "pointer",
            color: docsExpanded ? "#0033A0" : "var(--text-muted)",
            fontSize: "11px",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            transition: "all 0.2s"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Paperclip size={14} style={{ color: docsExpanded ? "#0033A0" : "var(--text-muted)", transform: "rotate(45deg)" }} />
            <span>Attachments</span>
            <span style={{
              background: docsExpanded ? "rgba(0, 51, 160, 0.08)" : "rgba(0, 0, 0, 0.06)",
              color: docsExpanded ? "#0033A0" : "var(--text)",
              borderRadius: "9999px",
              padding: "1px 6px",
              fontSize: "9px",
              fontWeight: 800,
              marginLeft: 4,
              border: docsExpanded ? "1.5px solid rgba(0, 51, 160, 0.3)" : "1.5px solid var(--border)"
            }}>
              {attachmentsList.length}
            </span>
          </div>
          <span style={{ transition: "transform 0.2s", transform: docsExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>▲</span>
        </button>
        
        {docsExpanded && (
          <div style={{
            padding: "12px 20px 20px 20px",
            background: "rgba(0,0,0,0.02)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderTop: "1px solid var(--border)",
            maxHeight: "180px",
            overflowY: "auto"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>File Attachments:</span>
              <button
                type="button"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  border: "1px solid #0033A0",
                  background: "rgba(0, 51, 160, 0.08)",
                  color: "#0033A0",
                  borderRadius: "4px",
                  padding: "3px 8px",
                  fontSize: "9px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                <UploadCloud size={10} /> Upload
              </button>
            </div>
            {attachmentsList.length === 0 ? (
              <span style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>No files attached to Smartsheet yet.</span>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {attachmentsList.map((file: any, i: number) => (
                  <a
                    key={i}
                    href={file.downloadUrl || "#"}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 11, color: "var(--text)", textDecoration: "underline", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <FileText size={12} style={{ color: "#0033A0" }} /> {file.name || `Attachment ${i + 1}`}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

// -----------------------------------------------------------------------------
// 811 expiration pill — surfaces a filed/active dig ticket that is expiring
// within 7 days. Clicking it jumps to the 811 tab, selects the ticket, and
// opens the ITIC modal.
// -----------------------------------------------------------------------------
const EXPIRY_STATUSES = new Set<DigTicket["status"]>(["Filed", "Active", "Expiring"]);
const EXPIRY_DAY_MS = 24 * 60 * 60 * 1000;

function Eight11ExpiryPill({ job }: { job: Job }) {
  const [ticket, setTicket] = useState<DigTicket | null>(null);
  const { username, isManager } = useAuth();

  useEffect(() => {
    let cancelled = false;
    const owner = isManager ? "*" : username || "";
    api
      .listDigTickets(owner)
      .then(({ tickets }) => {
        if (cancelled) return;
        const match = tickets.find(
          (t) => t.jobId === job.jobId && EXPIRY_STATUSES.has(t.status),
        );
        setTicket(match ?? null);
      })
      .catch(() => {
        if (!cancelled) setTicket(null);
      });
    return () => {
      cancelled = true;
    };
  }, [job.jobId, username, isManager]);

  if (!ticket || ticket.dates.expiresAt == null) return null;

  const daysLeft = Math.floor((ticket.dates.expiresAt - Date.now()) / EXPIRY_DAY_MS);
  if (daysLeft > 7) return null;

  let label: string;
  let bg: string;
  let color: string;
  if (daysLeft <= 0) {
    label = "811: expired";
    bg = "#c33";
    color = "#fff";
  } else if (daysLeft < 1) {
    label = "811: today";
    bg = "#c33";
    color = "#fff";
  } else {
    label = `811: ${daysLeft}d`;
    bg = "#f5a623";
    color = "#1a1a1a";
  }

  const openTicket = () => {
    const detail = { ticketId: ticket.id, openIticModal: true };
    try {
      sessionStorage.setItem("nsc.lumina.openDigTicket", JSON.stringify(detail));
    } catch {
      /* ignore disabled storage */
    }
    window.dispatchEvent(new CustomEvent("nsc:request-tab", { detail: { tab: "811-tickets" } }));
    window.dispatchEvent(new CustomEvent("nsc:lumina:openDigTicket", { detail }));
  };

  return (
    <button
      type="button"
      className="status-pill"
      onClick={openTicket}
      title={`Dig ticket ${ticket.ticketNumber || ""} — open on the 811 tab`}
      style={{
        background: bg,
        color,
        border: "none",
        cursor: "pointer",
        fontWeight: 700,
        fontSize: "9px",
        borderRadius: "4px",
        padding: "2px 6px"
      }}
    >
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Helper components for layout.
// -----------------------------------------------------------------------------
function SaveIndicator({
  saving,
  saved,
  error,
}: {
  saving: boolean;
  saved: boolean;
  error: boolean;
}) {
  if (saving) return <span style={{ fontSize: 9, color: "#38bdf8" }}>Saving…</span>;
  if (saved) return <span style={{ fontSize: 9, color: "#34d399" }}>Saved</span>;
  if (error) return <span style={{ fontSize: 9, color: "#f87171" }}>Error</span>;
  return null;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0" }}>
      <span style={{ color: "#94a3b8" }}>{label}</span>
      <span style={{ fontWeight: 600, color: "#f1f5f9" }}>{value}</span>
    </div>
  );
}

function EditableRow({
  label,
  value,
  type,
  options = [],
  onChange,
  toggleValue = false,
  onToggle,
  saving,
  saved,
  error,
}: {
  label: string;
  value: string;
  type: "select" | "date" | "toggle";
  options?: string[];
  onChange?: (v: string) => void;
  toggleValue?: boolean;
  onToggle?: (v: boolean) => void;
  saving?: boolean;
  saved?: boolean;
  error?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, padding: "2px 0" }}>
      <span style={{ color: "#475569" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <SaveIndicator saving={!!saving} saved={!!saved} error={!!error} />
        {type === "select" && onChange && (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ background: "#ffffff", border: "1px solid #cbd5e1", color: "#0f172a", borderRadius: 4, padding: "2px 4px", fontSize: 10, cursor: "pointer", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)" }}
          >
            <option value="">Choose...</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )}
        {type === "date" && onChange && (
          <input
            type="date"
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            style={{ background: "#ffffff", border: "1px solid #cbd5e1", color: "#0f172a", borderRadius: 4, padding: "2px 4px", fontSize: 10, cursor: "pointer", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)" }}
          />
        )}
        {type === "toggle" && onToggle && (
          <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={toggleValue}
              onChange={(e) => onToggle(e.target.checked)}
              style={{ accentColor: "#0033A0", cursor: "pointer" }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

function EditableNotes({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setVal(value);
  }, [value]);

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        style={{
          background: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: 6,
          padding: 8,
          fontSize: 11,
          lineHeight: 1.45,
          color: value ? "#0f172a" : "#64748b",
          fontStyle: value ? "normal" : "italic",
          cursor: "pointer",
          minHeight: 48,
          whiteSpace: "pre-wrap",
          boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
        }}
      >
        {value || "Tap to add project notes..."}
      </div>
    );
  }

  const done = () => {
    setEditing(false);
    if (val !== value) onCommit(val);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <textarea
        ref={ref}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={done}
        style={{
          width: "100%",
          minHeight: 100,
          background: "#ffffff",
          border: "1px solid #0033A0",
          boxShadow: "0 0 6px rgba(0,51,160,0.15)",
          color: "#0f172a",
          borderRadius: 6,
          padding: 8,
          fontSize: 11,
          fontFamily: "inherit",
          outline: "none",
          resize: "vertical",
        }}
        autoFocus
      />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={done}
          style={{ background: "#0033A0", color: "#ffffff", border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}
