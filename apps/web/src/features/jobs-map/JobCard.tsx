// Compact job card with unified styling (Lumen & Ziply) and collapsible sections.
import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, ChevronRight, ChevronDown, CheckCircle2, Wand2, Calendar, FileDown, UploadCloud, Layers } from "lucide-react";
import { useMap } from "@vis.gl/react-google-maps";
import type { DigTicket, Job } from "@nsc/types";
import { Link } from "react-router-dom";
import { MARKER_COLORS, colorKeyForSecondaryStatus } from "./markerStyle.js";
import { api } from "../../lib/api.js";
import { useAuth } from "../auth/authContext.js";
import Eight11Section from "./Eight11Section.js";
import { computePlantProgress, isZiplyJob } from "../ziply/ziplyUtils.js";
import ZiplyAlignmentStudio from "../ziply/ZiplyAlignmentStudio.js";

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

  // Collapse/Expand state
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [alignStudioOpen, setAlignStudioOpen] = useState(false);

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

  return (
    <div className={`job-card job-card--${variant} theme-${activeTheme}`} style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px" }}>
      <header className="job-card__head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="job-card__head-left" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="job-card__wo" style={{ fontSize: "16px", fontWeight: 800 }}>{wo}</span>
          
          {/* Status pill with neon border */}
          <span style={{
            border: "1.5px solid #06B6D4",
            boxShadow: "0 0 8px rgba(6, 182, 212, 0.3)",
            background: "rgba(6, 182, 212, 0.05)",
            color: "#06B6D4",
            borderRadius: "9999px",
            padding: "2px 8px",
            fontSize: "9px",
            fontWeight: 800,
            letterSpacing: "0.05em",
            textTransform: "uppercase"
          }}>
            {secondary || status}
          </span>

          {!job.inTracker && (
            <span className="status-pill status-archived">Archived</span>
          )}
          <Eight11ExpiryPill job={job} />
        </div>

        <div className="job-card__head-actions" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <select
            value={activeTheme}
            onChange={(e) => setActiveTheme(e.target.value as any)}
            style={{
              background: "rgba(0, 0, 0, 0.35)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "#a0aec0",
              fontSize: 8,
              fontWeight: 700,
              borderRadius: 4,
              padding: "2px 4px",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              outline: "none",
            }}
            title="Choose Preview Theme"
          >
            <option value="steel">Steel</option>
            <option value="cyberpunk">Cyberpunk</option>
            <option value="titanium">Titanium</option>
            <option value="glass">Glass</option>
          </select>

          {variant === "popup" && (
            <button
              className="icon-btn"
              onClick={() => setMinimized(true)}
              aria-label="Minimize job card"
              title="Minimize"
            >
              −
            </button>
          )}
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
      </header>

      {/* Primary Details Block */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, background: "rgba(255,255,255,0.02)", padding: 8, borderRadius: 8 }}>
        <Row label="Address" value={job.address} />
        <Row label="City" value={job.city} />
        <Row label="Supervisor" value={job.constructionSupervisor || "Unassigned"} />
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />

      {/* Collapsible Project Notes */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <button
          type="button"
          onClick={() => setNotesExpanded(!notesExpanded)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "none",
            border: "none",
            color: "#fff",
            fontWeight: 700,
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            cursor: "pointer",
            width: "100%",
            textAlign: "left",
            padding: "4px 0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span>NSC Project Notes</span>
            <SaveIndicator
              saving={savingField === "notes"}
              saved={savedField === "notes"}
              error={errField === "notes"}
            />
          </div>
          {notesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        
        {notesExpanded && (
          <div style={{ marginTop: 6 }}>
            <EditableNotes value={notes} onCommit={(v) => { setNotes(v); commit("notes", v); }} />
          </div>
        )}
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />

      {/* Scheduling & Details */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h4 style={{ fontSize: 10, fontWeight: 700, color: "#a0aec0", textTransform: "uppercase", margin: "0 0 4px 0", letterSpacing: "0.05em" }}>
          Scheduling & Details
        </h4>
        <EditableRow
          label="Crew / Foreman"
          value={foreman}
          type="select"
          options={foremanOptions}
          onChange={(v) => {
            setForeman(v);
            commit("foreman", v);
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
            commit("schedDate", v || null);
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
            commit("tcRequired", v);
          }}
          saving={savingField === "tcRequired"}
          saved={savedField === "tcRequired"}
          error={errField === "tcRequired"}
        />
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />

      {/* 811 Locate Section */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h4 style={{ fontSize: 10, fontWeight: 700, color: "#a0aec0", textTransform: "uppercase", margin: "0 0 4px 0", letterSpacing: "0.05em" }}>
          811 Locate shape
        </h4>
        <Eight11Section job={job} />
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />

      {/* Documents & Attachments Section */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyItems: "space-between" }}>
          <h4 style={{ fontSize: 10, fontWeight: 700, color: "#a0aec0", textTransform: "uppercase", margin: 0, letterSpacing: "0.05em", flexGrow: 1 }}>
            Documents & Attachments
          </h4>
          <button
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              border: "1.5px solid #06B6D4",
              background: "rgba(6, 182, 212, 0.05)",
              color: "#06B6D4",
              boxShadow: "0 0 6px rgba(6, 182, 212, 0.15)",
              borderRadius: "6px",
              padding: "3px 8px",
              fontSize: "9px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <UploadCloud size={10} /> Upload
          </button>
        </div>

        {attachmentsList.length === 0 ? (
          <span style={{ fontSize: 10, color: "#64748b", fontStyle: "italic", marginTop: 4 }}>No attachments uploaded yet.</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
            {attachmentsList.map((file: any, i: number) => (
              <a
                key={i}
                href={file.downloadUrl || "#"}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: "#cbd5e1", textDecoration: "underline", display: "flex", alignItems: "center", gap: 4 }}
              >
                <FileText size={12} /> {file.name || `Attachment ${i + 1}`}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Georeferencing / PRINT OVERLAY Section */}
      {isZiplyJob(job) && (
        <>
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h4 style={{ fontSize: 10, fontWeight: 700, color: "#a0aec0", textTransform: "uppercase", margin: 0, letterSpacing: "0.05em" }}>
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
                    border: "1.5px solid #06B6D4",
                    background: "rgba(6, 182, 212, 0.1)",
                    color: "#06B6D4",
                    boxShadow: "0 0 10px rgba(6, 182, 212, 0.25)",
                    borderRadius: "8px",
                    padding: "8px",
                    fontSize: "11px",
                    fontWeight: 800,
                    letterSpacing: "0.05em",
                    cursor: "pointer",
                  }}
                  onClick={() => setAlignStudioOpen(true)}
                >
                  <Layers size={12} /> PRINT OVERLAY
                </button>
              </div>
            ) : (
              <div style={{ background: "rgba(255,255,255,0.03)", padding: 10, borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                  <span style={{ color: "#94a3b8" }}>Bore Complete</span>
                  <span style={{ fontWeight: 700 }}>{stats.completeFt} ft / {stats.totalFt} ft</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                  <span style={{ color: "#94a3b8" }}>Terminals Installed</span>
                  <span style={{ fontWeight: 700 }}>{stats.complete} / {stats.total}</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    style={{
                      width: "100%",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      background: "rgba(255,255,255,0.05)",
                      color: "#e2e8f0",
                      borderRadius: "6px",
                      padding: "4px",
                      fontSize: "9px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                    onClick={() => setAlignStudioOpen(true)}
                  >
                    Adjust Print Overlay
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {alignStudioOpen && (
        <ZiplyAlignmentStudio job={job} onClose={() => setAlignStudioOpen(false)} />
      )}
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

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}
