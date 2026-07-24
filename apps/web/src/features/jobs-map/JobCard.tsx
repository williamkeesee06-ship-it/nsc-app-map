// Compact job card with unified styling (Lumen & Ziply) and collapsible sections.
// Upgraded to support 12 distinct interactive premium layout variants with neon animations and full print overlay page/opacity control.
import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, ChevronRight, ChevronDown, CheckCircle2, Wand2, Calendar, FileDown, UploadCloud, Layers, Shield, Settings, Sliders, Info, HardDrive } from "lucide-react";
import type { DigTicket, Job } from "@nsc/types";
import { api } from "../../lib/api.js";
import { useAuth } from "../auth/authContext.js";
import Eight11Section from "./Eight11Section.js";
import { computePlantProgress, isZiplyJob } from "../ziply/ziplyUtils.js";
import "./jobCardThemes.css";

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
}: Props) {
  const { username, isManager } = useAuth();
  const [minimized, setMinimized] = useState(false);
  const [activeLayout, setActiveLayout] = useState<number>(4); // Default to Cyberpunk HUD (Layout 4) as it's the most premium
  const wo = job.workOrder;
  const status = job.jobStatus ?? "—";

  // Collapse/Expand states
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [overlaysExpanded, setOverlaysExpanded] = useState(true);
  const [progressExpanded, setProgressExpanded] = useState(true);

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
  }, [job.jobId, job.secondaryJobStatus, job.constructionCrewForeman, job.scheduleDate, job.trafficControlRequired, job.nscProjectNotes]);

  // Save indicator states
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

  // Active print overlay documents / pages configuration
  const overlayPages = job.printOverlay?.pages ?? [
    { id: "demo-p1", pageNumber: 1, label: "Page 1 · Cover Sheet", excluded: false },
    { id: "demo-p2", pageNumber: 2, label: "Page 2 · Utility Grid Map", excluded: false },
    { id: "demo-p3", pageNumber: 3, label: "Page 3 · Splice Map", excluded: true },
  ];
  
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

  if (minimized && variant === "popup") {
    return (
      <div className="job-card-pill glass-panel pulse-glow-cyan" title={`${wo} · ${status}`} style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 10, borderRadius: "24px" }}>
        <span style={{ fontSize: "11px", fontWeight: 800, color: "#06B6D4" }}>{wo}</span>
        <button
          onClick={() => setMinimized(false)}
          style={{ background: "none", border: "none", color: "#a0aec0", cursor: "pointer", fontSize: 12 }}
          title="Restore card"
        >
          Expand ↕
        </button>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14 }}
          >
            ×
          </button>
        )}
      </div>
    );
  }

  const foremanOptions = schema?.foremanOptions ?? [];
  const ziplyPrintLayer = job.ziplyPrintLayer;
  const attachmentsList = ziplyPrintLayer?.permitFiles ?? [];
  const stats = computePlantProgress(job);

  // Common Elements for layout builders
  const renderLayoutPickerHeader = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(6, 182, 212, 0.08)", borderBottom: "1px solid rgba(6, 182, 212, 0.2)", width: "100%", justifyContent: "space-between", borderRadius: "8px 8px 0 0" }}>
      <span style={{ fontSize: 9, fontWeight: 800, color: "#06B6D4", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 4 }}>
        <Settings size={10} /> Layout:
      </span>
      <select
        value={activeLayout}
        onChange={(e) => setActiveLayout(Number(e.target.value))}
        style={{
          background: "#0f172a",
          border: "1px solid #06b6d4",
          color: "#06b6d4",
          fontSize: "10px",
          borderRadius: "4px",
          padding: "2px 6px",
          outline: "none",
          fontWeight: "bold",
          cursor: "pointer"
        }}
      >
        <option value={1}>1. Asymmetric Bento Grid</option>
        <option value={2}>2. Double-Bezel Hardware</option>
        <option value={3}>3. Editorial Split Pane</option>
        <option value={4}>4. Cyberpunk HUD Console</option>
        <option value={5}>5. Glassmorphic Card Stack</option>
        <option value={6}>6. Chrono Workflow Timeline</option>
        <option value={7}>7. Minimalist Accordion Stack</option>
        <option value={8}>8. Industrial Rivet Dashboard</option>
        <option value={9}>9. Circular HUD Sidebar</option>
        <option value={10}>10. Card-Within-Card Bezel</option>
        <option value={11}>11. Grid Telemetry Table</option>
        <option value={12}>12. Swipeable Wizard Carousel</option>
      </select>
    </div>
  );

  const renderPrintOverlayManager = (glowColor: string = "#06b6d4") => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Opacity Control slider */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ color: "#94a3b8", fontSize: "10px", fontWeight: 700, textTransform: "uppercase" }}>Page Opacity Control:</label>
            <select
              value={activePageSelId}
              onChange={(e) => setActivePageSelId(e.target.value)}
              style={{
                background: "rgba(0,0,0,0.35)",
                border: `1px solid ${glowColor}`,
                color: "#fff",
                fontSize: 9,
                padding: "1px 4px",
                borderRadius: 4
              }}
            >
              {overlayPages.map(p => (
                <option key={p.id} value={p.id}>Page {p.pageNumber}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 9, color: "#64748b" }}>0%</span>
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
              className="cyber-range"
              style={{ flexGrow: 1 }}
            />
            <span style={{ fontSize: 10, color: glowColor, fontWeight: 800 }}>{Math.round(activePageOpacity * 100)}%</span>
          </div>
        </div>

        {/* Page Checklist togglers */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ color: "#94a3b8", fontSize: "10px", fontWeight: 700, textTransform: "uppercase" }}>Print Pages Checklist:</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {overlayPages.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.2)", padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.02)" }}>
                <span style={{ fontSize: 10, color: p.excluded ? "#64748b" : "#f1f5f9" }}>{p.label}</span>
                <label className="cyber-switch">
                  <input
                    type="checkbox"
                    checked={!p.excluded}
                    onChange={() => void togglePageExcluded(p.id)}
                  />
                  <span className="cyber-slider"></span>
                </label>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            border: `1.5px solid ${glowColor}`,
            background: "rgba(6, 182, 212, 0.05)",
            color: glowColor,
            boxShadow: `0 0 8px rgba(6, 182, 212, 0.15)`,
            borderRadius: "6px",
            padding: "6px",
            fontSize: "10px",
            fontWeight: 800,
            cursor: "pointer",
            marginTop: 4,
            transition: "all 0.2s"
          }}
          onClick={() => window.open(`/print-overlay/jobs/${job.jobId}`, "_blank")}
        >
          <Layers size={11} /> ADJUST PRINT ALIGNMENT ↗
        </button>
      </div>
    );
  };

  // ──────── LAYOUT 1: Asymmetric Bento Grid ────────
  const renderLayoutBento = () => {
    return (
      <div className="bento-container" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Header Block */}
        <div className="bento-card" style={{ borderLeft: "4px solid #06b6d4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>WORK ORDER</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#f1f5f9" }}>{wo}</div>
          </div>
          <span style={{ border: "1px solid #06b6d4", padding: "3px 8px", borderRadius: 20, fontSize: 9, fontWeight: 800, color: "#06b6d4", background: "rgba(6,182,212,0.05)" }}>
            {secondary || status}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {/* Metadata Block */}
          <div className="bento-card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 9, color: "#64748b", fontWeight: 800 }}>ADDRESS / CITY</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#f1f5f9" }}>{job.address}</span>
            <span style={{ fontSize: 9, color: "#94a3b8" }}>{job.city}</span>
          </div>
          {/* Supervisor & Crew Block */}
          <div className="bento-card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 9, color: "#64748b", fontWeight: 800 }}>OPERATIONS</span>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>Super: <strong style={{ color: "#fff" }}>{job.constructionSupervisor || "Unassigned"}</strong></span>
            <div style={{ marginTop: 2 }}>
              <EditableRow
                label="Crew:"
                value={foreman}
                type="select"
                options={foremanOptions}
                onChange={(v: string) => { setForeman(v); void commit("foreman", v); }}
                saving={savingField === "foreman"}
                saved={savedField === "foreman"}
                error={errField === "foreman"}
              />
            </div>
          </div>
        </div>

        {/* Progress Block */}
        <div className="bento-card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 9, color: "#64748b", fontWeight: 800 }}>ZIPLY CONSTRUCTION PROGRESS</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 2 }}>
                <span>Bore Footage:</span>
                <span style={{ fontWeight: 800, color: "#10b981" }}>{stats.completeFt} / {stats.totalFt} ft</span>
              </div>
              <div style={{ width: "100%", height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${stats.totalFt > 0 ? (stats.completeFt / stats.totalFt) * 100 : 0}%`, height: "100%", background: "#10b981" }} />
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 2 }}>
                <span>Splice Terminals:</span>
                <span style={{ fontWeight: 800, color: "#06b6d4" }}>{stats.complete} / {stats.total} set</span>
              </div>
              <div style={{ width: "100%", height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${stats.total > 0 ? (stats.complete / stats.total) * 100 : 0}%`, height: "100%", background: "#06b6d4" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Print Overlay Block */}
        <div className="bento-card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 9, color: "#64748b", fontWeight: 800 }}>GEOLOCKED PRINT OVERLAYS</span>
          {renderPrintOverlayManager("#06b6d4")}
        </div>

        {/* Notes Block */}
        <div className="bento-card">
          <span style={{ fontSize: 9, color: "#64748b", fontWeight: 800, display: "flex", alignItems: "center", gap: 4 }}>
            NSC PROJECT NOTES
            <SaveIndicator saving={savingField === "notes"} saved={savedField === "notes"} error={errField === "notes"} />
          </span>
          <div style={{ marginTop: 6 }}>
            <EditableNotes value={notes} onCommit={(v: string) => { setNotes(v); void commit("notes", v); }} />
          </div>
        </div>
      </div>
    );
  };

  // ──────── LAYOUT 2: Double-Bezel Tabbed Drawer ────────
  const [activeTab, setActiveTab] = useState<"info" | "progress" | "overlays" | "docs">("overlays");
  const renderLayoutDoubleBezel = () => {
    return (
      <div className="glass-bezel-outer" style={{ padding: "6px" }}>
        <div className="glass-bezel-inner" style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 10 }}>
          
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: "#fff", letterSpacing: "0.04em" }}>WO [{wo}]</span>
            <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#22d3ee" }}>
              {secondary || status}
            </span>
          </div>

          {/* Navigation tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 4, gap: 4 }}>
            {(["info", "progress", "overlays", "docs"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  background: activeTab === tab ? "rgba(255,255,255,0.05)" : "none",
                  border: activeTab === tab ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
                  borderBottom: "none",
                  color: activeTab === tab ? "#22d3ee" : "#64748b",
                  fontSize: 9,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  padding: "4px 8px",
                  borderRadius: "4px 4px 0 0",
                  cursor: "pointer"
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === "info" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Row label="Address" value={job.address} />
              <Row label="City" value={job.city} />
              <Row label="Supervisor" value={job.constructionSupervisor || "Unassigned"} />
              <div style={{ height: 1, background: "rgba(255,255,255,0.05)" }} />
              <EditableRow
                label="Foreman"
                value={foreman}
                type="select"
                options={foremanOptions}
                onChange={(v: string) => { setForeman(v); void commit("foreman", v); }}
                saving={savingField === "foreman"}
                saved={savedField === "foreman"}
                error={errField === "foreman"}
              />
              <EditableRow
                label="Sched Date"
                value={schedDate}
                type="date"
                onChange={(v: string) => { setSchedDate(v); void commit("schedDate", v || null); }}
                saving={savingField === "schedDate"}
                saved={savedField === "schedDate"}
                error={errField === "schedDate"}
              />
            </div>
          )}

          {activeTab === "progress" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700 }}>ZIPLY CONSTRUCTION PROGRESS</span>
              <div style={{ background: "rgba(255,255,255,0.02)", padding: 8, borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)" }}>
                <Row label="Bore Completed" value={`${stats.completeFt} ft / ${stats.totalFt} ft`} />
                <Row label="Terminals Placed" value={`${stats.complete} / ${stats.total}`} />
              </div>
            </div>
          )}

          {activeTab === "overlays" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {renderPrintOverlayManager("#22d3ee")}
            </div>
          )}

          {activeTab === "docs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 9, color: "#94a3b8" }}>Permit Attachments:</span>
                <button style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontSize: 8, padding: "2px 6px", borderRadius: 4 }}>Upload</button>
              </div>
              {attachmentsList.map((file: any, i: number) => (
                <a key={i} href={file.downloadUrl || "#"} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#cbd5e1", display: "flex", alignItems: "center", gap: 4 }}>
                  <FileText size={10} /> {file.name}
                </a>
              ))}
            </div>
          )}

        </div>
      </div>
    );
  };

  // ──────── LAYOUT 3: Editorial Split Pane ────────
  const renderLayoutEditorial = () => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "'Inter', sans-serif" }}>
        {/* Huge Typographic Header */}
        <div>
          <span style={{ fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#64748b", fontWeight: 800 }}>JOB WORK ORDER</span>
          <h1 style={{ fontSize: "32px", fontWeight: 900, lineHeight: 1.0, margin: "2px 0 0 0", color: "#fff" }}>#{wo}</h1>
          <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#a0aec0", fontStyle: "italic" }}>{secondary || status}</p>
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.12)" }} />

        {/* Staggered Split Details */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h4 style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", margin: 0 }}>BUILD LOCATION</h4>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{job.address}</div>
              <div style={{ fontSize: 10, color: "#a0aec0" }}>{job.city}</div>
            </div>
            <div style={{ marginTop: 4 }}>
              <span style={{ fontSize: 9, color: "#64748b" }}>SUPERVISOR:</span>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{job.constructionSupervisor || "Unassigned"}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 12 }}>
            <h4 style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", margin: 0 }}>CREW DETAILS</h4>
            <EditableRow
              label="Foreman"
              value={foreman}
              type="select"
              options={foremanOptions}
              onChange={(v: string) => { setForeman(v); void commit("foreman", v); }}
            />
            <EditableRow
              label="Date"
              value={schedDate}
              type="date"
              onChange={(v: string) => { setSchedDate(v); void commit("schedDate", v || null); }}
            />
          </div>
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

        {/* Print overlay */}
        <div>
          <h4 style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", margin: "0 0 8px 0" }}>MAP PRINT OVERLAYS</h4>
          {renderPrintOverlayManager("#fff")}
        </div>
      </div>
    );
  };

  // ──────── LAYOUT 4: Cyberpunk HUD Console (Most Premium) ────────
  const renderLayoutCyberpunk = () => {
    return (
      <div className="cyberpunk-hud" style={{ padding: "14px", borderRadius: "10px" }}>
        
        {/* Neon scan lines / framing */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #06b6d4", paddingBottom: "6px", marginBottom: "8px" }}>
          <div>
            <span style={{ fontSize: "9px", color: "#06b6d4", letterSpacing: "0.15em" }}>// SYSTEM.ACTIVE //</span>
            <div style={{ fontSize: "19px", fontWeight: 900, color: "#fff", textShadow: "0 0 8px #06b6d4" }}>WO_{wo}</div>
          </div>
          <span style={{ animation: "neon-pulse-cyan 2s infinite", border: "1px solid #06b6d4", padding: "2px 8px", borderRadius: "4px", fontSize: "8px", fontWeight: "bold", background: "rgba(6,182,212,0.1)" }}>
            {secondary || status}
          </span>
        </div>

        {/* Telemetry rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0", background: "rgba(6, 182, 212, 0.03)", padding: "8px", border: "1px solid rgba(6, 182, 212, 0.15)", borderRadius: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px" }}>
            <span style={{ color: "#06b6d4" }}>GPS_ADDR:</span>
            <span style={{ fontWeight: "bold" }}>{job.address}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px" }}>
            <span style={{ color: "#06b6d4" }}>CITY_NODE:</span>
            <span style={{ fontWeight: "bold" }}>{job.city}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px" }}>
            <span style={{ color: "#06b6d4" }}>SYS_SUPER:</span>
            <span style={{ fontWeight: "bold" }}>{job.constructionSupervisor || "UNASSIGNED"}</span>
          </div>
        </div>

        {/* Segmented meter loops */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "10px 0" }}>
          <div style={{ border: "1px solid rgba(6,182,212,0.15)", padding: "8px", borderRadius: "6px", display: "flex", alignItems: "center", gap: 8 }}>
            <div className="cyber-progress-ring" style={{ color: "#10b981", borderColor: "#10b981" }}>
              <span style={{ fontSize: "10px", fontWeight: 900 }}>0%</span>
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#10b981", fontWeight: 800 }}>BORE_FUT</div>
              <div style={{ fontSize: 10, fontWeight: "bold" }}>0 / 550 ft</div>
            </div>
          </div>
          <div style={{ border: "1px solid rgba(6,182,212,0.15)", padding: "8px", borderRadius: "6px", display: "flex", alignItems: "center", gap: 8 }}>
            <div className="cyber-progress-ring" style={{ color: "#d946ef", borderColor: "#d946ef" }}>
              <span style={{ fontSize: "10px", fontWeight: 900 }}>0%</span>
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#d946ef", fontWeight: 800 }}>TERM_PNT</div>
              <div style={{ fontSize: 10, fontWeight: "bold" }}>0 / 32 set</div>
            </div>
          </div>
        </div>

        {/* Interactive Print overlay Controls */}
        <div style={{ border: "1px dashed rgba(6,182,212,0.3)", padding: "10px", borderRadius: "6px", marginTop: "10px" }}>
          <div style={{ fontSize: "9px", color: "#06b6d4", fontWeight: 900, marginBottom: "8px", letterSpacing: "0.08em" }}>// PRINT_GEOLOCK_CONTROLS //</div>
          {renderPrintOverlayManager("#06b6d4")}
        </div>

        {/* 811 integration */}
        <div style={{ marginTop: 10 }}>
          <Eight11Section job={job} />
        </div>
      </div>
    );
  };

  // ──────── LAYOUT 5: Glassmorphic Card Stack ────────
  const renderLayoutGlass = () => {
    return (
      <div className="glass-panel" style={{ padding: "14px", borderRadius: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
        
        {/* Pill header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", padding: "3px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: 800 }}>
            {wo}
          </div>
          <span style={{ fontSize: 10, color: "#38bdf8", fontWeight: 700 }}>● {secondary || status}</span>
        </div>

        {/* Metadata glass cards */}
        <div style={{ background: "rgba(255,255,255,0.02)", padding: "10px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
          <Row label="Address" value={job.address} />
          <Row label="City" value={job.city} />
          <Row label="Supervisor" value={job.constructionSupervisor} />
        </div>

        {/* Print controls inside glass */}
        <div style={{ background: "rgba(255,255,255,0.02)", padding: "10px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
          <h4 style={{ fontSize: 10, color: "#38bdf8", fontWeight: 800, margin: "0 0 6px 0" }}>PRINT RASTER OVERLAYS</h4>
          {renderPrintOverlayManager("#38bdf8")}
        </div>
      </div>
    );
  };

  // ──────── LAYOUT 6: Chronological Workflow Timeline ────────
  const renderLayoutTimeline = () => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        
        <div style={{ padding: "10px", background: "rgba(255,255,255,0.02)", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 900 }}>WO: {wo}</span>
          <span style={{ fontSize: 10, color: "#a0aec0" }}>{secondary || status}</span>
        </div>

        {/* Timeline Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: "10px", borderLeft: "2px solid rgba(255,255,255,0.06)", marginLeft: "6px" }}>
          
          {/* Step 1 */}
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: "-15px", top: "2px", width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
            <div style={{ fontSize: 10, color: "#10b981", fontWeight: 800 }}>STEP 1: LOCATION DETAILS</div>
            <div style={{ fontSize: 11, color: "#fff", marginTop: 2 }}>{job.address}, {job.city}</div>
          </div>

          {/* Step 2 */}
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: "-15px", top: "2px", width: "8px", height: "8px", borderRadius: "50%", background: "#06b6d4", boxShadow: "0 0 6px #06b6d4" }} />
            <div style={{ fontSize: 10, color: "#06b6d4", fontWeight: 800 }}>STEP 2: PRINT OVERLAY & GEOLOCK</div>
            <div style={{ marginTop: 4 }}>
              {renderPrintOverlayManager("#06b6d4")}
            </div>
          </div>

          {/* Step 3 */}
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: "-15px", top: "2px", width: "8px", height: "8px", borderRadius: "50%", background: "#f5a623" }} />
            <div style={{ fontSize: 10, color: "#f5a623", fontWeight: 800 }}>STEP 3: CONSTRUCTION MARKUP</div>
            <div style={{ fontSize: 11, color: "#a0aec0", marginTop: 2 }}>
              Bore completed: {stats.completeFt} ft / {stats.totalFt} ft
            </div>
          </div>

        </div>
      </div>
    );
  };

  // ──────── LAYOUT 7: Minimalist Accordion Stack ────────
  const renderLayoutAccordion = () => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px", background: "rgba(255,255,255,0.03)", borderRadius: "6px" }}>
          <span style={{ fontWeight: 800 }}>WO_{wo}</span>
          <span style={{ fontSize: 9, color: "#64748b" }}>{secondary || status}</span>
        </div>

        {/* Info Section */}
        <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
          <button
            onClick={() => setNotesExpanded(!notesExpanded)}
            style={{ width: "100%", padding: "8px 12px", background: "rgba(255,255,255,0.02)", border: "none", color: "#fff", display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
          >
            <span>LOCATION & METADATA</span>
            {notesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {notesExpanded && (
            <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 4, background: "rgba(0,0,0,0.15)" }}>
              <Row label="Address" value={job.address} />
              <Row label="Supervisor" value={job.constructionSupervisor} />
            </div>
          )}
        </div>

        {/* Overlays Section */}
        <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
          <button
            onClick={() => setOverlaysExpanded(!overlaysExpanded)}
            style={{ width: "100%", padding: "8px 12px", background: "rgba(255,255,255,0.02)", border: "none", color: "#fff", display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
          >
            <span>GEOLOCKED PRINT OVERLAYS</span>
            {overlaysExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {overlaysExpanded && (
            <div style={{ padding: 10, background: "rgba(0,0,0,0.15)" }}>
              {renderPrintOverlayManager("#06b6d4")}
            </div>
          )}
        </div>

        {/* Progress Section */}
        <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
          <button
            onClick={() => setProgressExpanded(!progressExpanded)}
            style={{ width: "100%", padding: "8px 12px", background: "rgba(255,255,255,0.02)", border: "none", color: "#fff", display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
          >
            <span>CONSTRUCTION METRICS</span>
            {progressExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {progressExpanded && (
            <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6, background: "rgba(0,0,0,0.15)" }}>
              <Row label="Bore Progress" value={`${stats.completeFt} ft / ${stats.totalFt} ft`} />
              <Row label="Terminals placed" value={`${stats.complete} / ${stats.total}`} />
            </div>
          )}
        </div>

      </div>
    );
  };

  // ──────── LAYOUT 8: Industrial Rivet Dashboard ────────
  const renderLayoutIndustrial = () => {
    return (
      <div className="industrial-panel" style={{ padding: "14px", borderRadius: "8px", position: "relative" }}>
        <div className="rivet rivet-tl" />
        <div className="rivet rivet-tr" />
        <div className="rivet rivet-bl" />
        <div className="rivet rivet-br" />

        <div style={{ textAlign: "center", borderBottom: "1px solid #475569", paddingBottom: "6px", marginBottom: "8px", marginTop: 4 }}>
          <span style={{ fontSize: "14px", fontWeight: "900", color: "#e2e8f0" }}>JOB SHEET: {wo}</span>
          <div style={{ fontSize: 9, color: "#94a3b8" }}>{secondary || status}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, background: "#0f172a", padding: 8, borderRadius: 4, border: "1px solid #334155" }}>
          <Row label="Address:" value={job.address} />
          <Row label="Supervisor:" value={job.constructionSupervisor} />
        </div>

        {/* Opacity tools */}
        <div style={{ marginTop: 8 }}>
          <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: "bold" }}>RASTER ALIGNMENT SYSTEM</span>
          <div style={{ background: "#0f172a", padding: 8, borderRadius: 4, border: "1px solid #334155", marginTop: 4 }}>
            {renderPrintOverlayManager("#94a3b8")}
          </div>
        </div>
      </div>
    );
  };

  // ──────── LAYOUT 9: Circular HUD Sidebar ────────
  const renderLayoutCircularHUD = () => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, background: "#090d16", border: "1px solid #3b82f6", padding: 12, borderRadius: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#3b82f6", fontWeight: "bold", fontSize: 12 }}>SYS.HUD_PANEL</span>
          <span style={{ fontSize: 10, color: "#fff" }}>{wo}</span>
        </div>

        {/* Circular rings */}
        <div style={{ display: "flex", justifyContent: "space-around", margin: "6px 0" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", border: "3px solid #10b981", display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 10, fontWeight: "bold" }}>0%</span>
            </div>
            <span style={{ fontSize: 8, color: "#10b981", marginTop: 4 }}>BORE</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", border: "3px solid #3b82f6", display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 10, fontWeight: "bold" }}>0%</span>
            </div>
            <span style={{ fontSize: 8, color: "#3b82f6", marginTop: 4 }}>TERMS</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <button
              onClick={() => window.open(`/print-overlay/jobs/${job.jobId}`, "_blank")}
              style={{ width: 44, height: 44, borderRadius: "50%", border: "3px solid #d946ef", display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "center", background: "none", color: "#fff", cursor: "pointer" }}
            >
              <span style={{ fontSize: 9, fontWeight: "bold" }}>EDIT</span>
            </button>
            <span style={{ fontSize: 8, color: "#d946ef", marginTop: 4 }}>ALIGN</span>
          </div>
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

        {renderPrintOverlayManager("#3b82f6")}
      </div>
    );
  };

  // ──────── LAYOUT 10: Card-Within-Card Bezel Hierarchy ────────
  const renderLayoutBezelHierarchy = () => {
    return (
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", padding: 8, borderRadius: 16 }}>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", padding: 8, borderRadius: 12 }}>
          
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 900 }}>WO_{wo}</span>
            <span style={{ fontSize: 9, color: "#a0aec0" }}>{secondary || status}</span>
          </div>

          <div style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(0,0,0,0.5)", padding: 8, borderRadius: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            <Row label="Address" value={job.address} />
            <Row label="Supervisor" value={job.constructionSupervisor} />
          </div>

          <div style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(0,0,0,0.5)", padding: 8, borderRadius: 8, display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            <span style={{ fontSize: 9, color: "#a0aec0", fontWeight: "bold" }}>ALIGNED PRINT RASTER SHEETS</span>
            {renderPrintOverlayManager("#06b6d4")}
          </div>

        </div>
      </div>
    );
  };

  // ──────── LAYOUT 11: Grid Telemetry Table ────────
  const renderLayoutTelemetryGrid = () => {
    return (
      <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, overflow: "hidden", fontSize: 10 }}>
        {/* ROW 1 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ padding: 6, borderRight: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.01)" }}>
            <div style={{ color: "#64748b", fontWeight: "bold" }}>JOB ID:</div>
            <div style={{ fontSize: 11, fontWeight: "bold" }}>{wo}</div>
          </div>
          <div style={{ padding: 6 }}>
            <div style={{ color: "#64748b", fontWeight: "bold" }}>STATUS:</div>
            <div style={{ color: "#06b6d4", fontWeight: "bold" }}>{secondary || status}</div>
          </div>
        </div>
        
        {/* ROW 2 */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ padding: 6, borderRight: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ color: "#64748b", fontWeight: "bold" }}>BUILD ADDR:</div>
            <div>{job.address}</div>
          </div>
          <div style={{ padding: 6 }}>
            <div style={{ color: "#64748b", fontWeight: "bold" }}>SUPERVISOR:</div>
            <div>{job.constructionSupervisor || "UNASSIGNED"}</div>
          </div>
        </div>

        {/* ROW 3 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ padding: 6, borderRight: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ color: "#64748b", fontWeight: "bold" }}>BORE PROGRESS:</div>
            <div>{stats.completeFt} / {stats.totalFt} ft</div>
          </div>
          <div style={{ padding: 6 }}>
            <div style={{ color: "#64748b", fontWeight: "bold" }}>TERMINALS:</div>
            <div>{stats.complete} / {stats.total} set</div>
          </div>
        </div>

        {/* ROW 4 - Prints */}
        <div style={{ padding: 8 }}>
          <div style={{ color: "#64748b", fontWeight: "bold", marginBottom: 6 }}>ALIGNED OVERLAYS & SCALING:</div>
          {renderPrintOverlayManager("#06b6d4")}
        </div>
      </div>
    );
  };

  // ──────── LAYOUT 12: Swipeable Wizard Carousel ────────
  const [wizardStep, setWizardStep] = useState<number>(1);
  const renderLayoutWizard = () => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "rgba(15,23,42,0.3)", padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: "bold" }}>WO {wo}</span>
          <span style={{ fontSize: 8, color: "#06b6d4" }}>STEP {wizardStep} OF 3</span>
        </div>

        {wizardStep === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 120 }}>
            <span style={{ fontSize: 9, color: "#64748b", fontWeight: "bold" }}>STEP 1: LOCATION DETAILS</span>
            <Row label="Address" value={job.address} />
            <Row label="City" value={job.city} />
            <Row label="Supervisor" value={job.constructionSupervisor} />
          </div>
        )}

        {wizardStep === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 120 }}>
            <span style={{ fontSize: 9, color: "#64748b", fontWeight: "bold" }}>STEP 2: PRINT OVERLAYS</span>
            {renderPrintOverlayManager("#06b6d4")}
          </div>
        )}

        {wizardStep === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 120 }}>
            <span style={{ fontSize: 9, color: "#64748b", fontWeight: "bold" }}>STEP 3: PROJECT NOTES</span>
            <EditableNotes value={notes} onCommit={(v: string) => { setNotes(v); void commit("notes", v); }} />
          </div>
        )}

        {/* Carousel buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
          <button
            disabled={wizardStep === 1}
            onClick={() => setWizardStep(prev => prev - 1)}
            style={{ background: "none", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: "#fff", fontSize: 9, padding: "2px 8px", cursor: "pointer", opacity: wizardStep === 1 ? 0.3 : 1 }}
          >
            Prev
          </button>
          
          <div style={{ display: "flex", gap: 4 }}>
            {[1, 2, 3].map(step => (
              <div key={step} style={{ width: 6, height: 6, borderRadius: "50%", background: wizardStep === step ? "#06b6d4" : "rgba(255,255,255,0.15)" }} />
            ))}
          </div>

          <button
            disabled={wizardStep === 3}
            onClick={() => setWizardStep(prev => prev + 1)}
            style={{ background: "none", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: "#fff", fontSize: 9, padding: "2px 8px", cursor: "pointer", opacity: wizardStep === 3 ? 0.3 : 1 }}
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  const renderActiveLayoutContent = () => {
    switch (activeLayout) {
      case 1: return renderLayoutBento();
      case 2: return renderLayoutDoubleBezel();
      case 3: return renderLayoutEditorial();
      case 4: return renderLayoutCyberpunk();
      case 5: return renderLayoutGlass();
      case 6: return renderLayoutTimeline();
      case 7: return renderLayoutAccordion();
      case 8: return renderLayoutIndustrial();
      case 9: return renderLayoutCircularHUD();
      case 10: return renderLayoutBezelHierarchy();
      case 11: return renderLayoutTelemetryGrid();
      case 12: return renderLayoutWizard();
      default: return renderLayoutCyberpunk();
    }
  };

  return (
    <div
      className="job-detail-card-wrapper"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        background: "#0b0f19",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "8px",
        overflow: "hidden",
        width: "100%"
      }}
    >
      {/* Layout Selection Control Header */}
      {renderLayoutPickerHeader()}

      {/* Main Layout Pane Wrapper */}
      <div style={{ padding: "12px" }}>
        {renderActiveLayoutContent()}
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
      <span style={{ color: "#94a3b8" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <SaveIndicator saving={!!saving} saved={!!saved} error={!!error} />
        {type === "select" && onChange && (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.12)", color: "#f1f5f9", borderRadius: 4, padding: "2px 4px", fontSize: 10, cursor: "pointer" }}
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
            style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.12)", color: "#f1f5f9", borderRadius: 4, padding: "2px 4px", fontSize: 10, cursor: "pointer" }}
          />
        )}
        {type === "toggle" && onToggle && (
          <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={toggleValue}
              onChange={(e) => onToggle(e.target.checked)}
              style={{ accentColor: "#06b6d4", cursor: "pointer" }}
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
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 6,
          padding: 8,
          fontSize: 11,
          lineHeight: 1.45,
          color: value ? "#e2e8f0" : "#64748b",
          fontStyle: value ? "normal" : "italic",
          cursor: "pointer",
          minHeight: 48,
          whiteSpace: "pre-wrap",
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
          background: "rgba(15,23,42,0.9)",
          border: "1px solid #06b6d4",
          boxShadow: "0 0 6px rgba(6,182,212,0.2)",
          color: "#fff",
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
          style={{ background: "#06b6d4", color: "#000", border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
