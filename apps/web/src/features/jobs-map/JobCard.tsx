// Compact job card with INLINE EDITING (Billy 5/21).
//   - Secondary Job Status pill → click to cycle through dropdown
//   - NSC Project Notes        → click to edit text
//   - Crew / Foreman           → click to open dropdown
//   - Schedule Date            → click to open date picker
//   - Traffic Control          → click toggle
// Saves write directly to Smartsheet via the nsc-smartapp Worker.
import { useEffect, useRef, useState } from "react";
import type { DigTicket, Job } from "@nsc/types";
import { Link } from "react-router-dom";
import { MARKER_COLORS, colorKeyForSecondaryStatus } from "./markerStyle.js";
import { api } from "../../lib/api.js";
import { useAuth } from "../auth/authContext.js";
import {
  formatBytes,
  getZiplyPrintAnchor,
  getZiplyPrintDocStatus,
  ingestZiplyPermitForJob,
  ingestZiplyPrintForJob,
  isZiplyPrintMapReady,
  listZiplyPrintFiles,
  ZIPLY_PERMIT_TYPES,
  ziplyPrintStatusColor,
  ziplyPrintStatusLabel,
  type ZiplyPermitTypeKey,
} from "../ziply/ziplyUtils.js";

interface Props {
  job: Job;
  onClose?: () => void;
  variant?: "popup" | "panel";
  theme?: "steel" | "cyberpunk" | "titanium" | "glass";
  onThemeChange?: (theme: "steel" | "cyberpunk" | "titanium" | "glass") => void;
}

const SS_WORKER = "https://nsc-smartapp.williamkeesee06.workers.dev";

// Cache the dropdown options between mounts so we don't refetch every click.
type Schema = { secondaryStatusOptions: string[]; foremanOptions: string[] };
let _schemaCache: Schema | null = null;
let _schemaPromise: Promise<Schema> | null = null;
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
    .catch(() => {
      const c: Schema = { secondaryStatusOptions: [], foremanOptions: [] };
      _schemaCache = c;
      return c;
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

  // Re-sync local state if the underlying job object changes (e.g. user clicks another job)
  useEffect(() => {
    setSecondary(job.secondaryJobStatus ?? "");
    setForeman(job.constructionCrewForeman ?? "");
    setSchedDate(job.scheduleDate ?? "");
    setTcReq(typeof job.trafficControlRequired === "boolean" ? job.trafficControlRequired : null);
    setNotes(job.nscProjectNotes ?? "");
  }, [job.jobId]);

  // Save indicator: "idle" | "saving" | "ok" | "err"
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
      // Billy 5/26: keep Firestore (and therefore the map view) in sync with
      // what we just wrote to Smartsheet. Without this, a refresh re-reads
      // stale Firestore data and the user's edit appears to revert.
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
        console.warn("Post-save sync failed (UI will still show update locally):", err);
      }
    } else {
      setErrField(field);
      console.error("Smartsheet save failed", field, res.error);
      setTimeout(() => setErrField(null), 4000);
    }
  }

  // Minimized pill — always rendered in popup variant
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
          ⌃
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

  return (
    <div className={`job-card job-card--${variant} theme-${activeTheme}`}>
      <header className="job-card__head">
        <div className="job-card__head-left">
          <span className="job-card__wo">{wo}</span>
          {/* Secondary status pill — now a dropdown (Billy 5/21) */}
          <SecondaryStatusEditablePill
            status={secondary}
            options={secondaryOptions}
            onChange={(v) => {
              setSecondary(v);
              commit("secondaryStatus", v);
            }}
            saving={savingField === "secondaryStatus"}
            saved={savedField === "secondaryStatus"}
            error={errField === "secondaryStatus"}
          />
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
              marginRight: 4
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

      {/* Primary job status row (read-only) */}
      <div style={{ paddingLeft: 12, paddingBottom: 4, marginTop: -2 }}>
        <span className={`status-pill status-${slugify(status)}`} style={{ fontSize: 9 }}>
          {status}
        </span>
      </div>

      <Row label="Address" value={job.address} />
      <Row label="City" value={job.city} />

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

      <Row label="Completed" value={fmtDate(job.actualCompletionDate)} />

      {/* Notes — always shown so user can add even when empty */}
      <div className="job-card__notes">
        <div className="job-card__notes-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          NSC Project Notes
          <SaveIndicator
            saving={savingField === "notes"}
            saved={savedField === "notes"}
            error={errField === "notes"}
          />
        </div>
        <EditableNotes value={notes} onCommit={(v) => { setNotes(v); commit("notes", v); }} />
      </div>

      {/* Ziply engineering print + permits (Ziply only — Lumen markups untouched) */}
      {job.customerProject === "Ziply" && (
        <ZiplyPrintDocsSection job={job} />
      )}

      {job.customerProject === "Ziply" && <ZiplyPermitsSection job={job} />}

    </div>
  );
}

// -----------------------------------------------------------------------------
// Ziply permits: upload PDF/image → Storage → AI extract → status board
// -----------------------------------------------------------------------------
function ZiplyPermitsSection({ job }: { job: Job }) {
  const [permitType, setPermitType] = useState<ZiplyPermitTypeKey>("cityRow");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const layer = job.ziplyPrintLayer;
  const permitFiles = layer?.permitFiles ?? [];
  const board = layer?.permits;

  const statusColor = (s: string) => {
    if (s === "Approved" || s === "Active") return "#00E676";
    if (s === "Closed") return "#6b7280";
    if (s === "processing" || s === "Pending") return "#ffb300";
    if (s === "failed") return "#f87171";
    return "#94a3b8";
  };

  const typeLabel = (id: string) =>
    ZIPLY_PERMIT_TYPES.find((t) => t.id === id)?.label ?? id;

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setPct(0);
    setErr(null);
    setMsg(null);
    try {
      await ingestZiplyPermitForJob(job.jobId, file, permitType, (p) =>
        setPct(Math.round(p))
      );
      setMsg(
        `Uploaded ${file.name} — AI is reading the permit (number, dates, conditions). Refresh in a few seconds.`
      );
      // Poll once after short delay so processing → complete shows without full manual reload
      window.setTimeout(() => {
        window.dispatchEvent(new Event("nsc:jobs-reload"));
      }, 4000);
      window.setTimeout(() => {
        window.dispatchEvent(new Event("nsc:jobs-reload"));
      }, 12000);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Permit upload failed");
    } finally {
      setBusy(false);
      setPct(0);
    }
  };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
      <h4
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          color: "#00E676",
          margin: "0 0 8px 0",
        }}
      >
        📋 PERMITS (upload + AI read)
      </h4>
      <p style={{ margin: "0 0 10px 0", fontSize: 9, color: "#94a3b8", lineHeight: 1.4 }}>
        Upload City ROW, WSDOT, County, Railroad, franchise, or TCP PDFs for this job. The app stores
        the file and extracts permit number, dates, work hours, streets, and conditions.
      </p>

      {/* Status board */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {ZIPLY_PERMIT_TYPES.filter((t) => t.id !== "other").map((t) => {
          const statusVal =
            board?.[t.id as keyof NonNullable<typeof board>] || "Pending";
          const latest = [...permitFiles]
            .filter((f) => f.permitType === t.id)
            .sort((a, b) => b.uploadedAt - a.uploadedAt)[0];
          const docUrl =
            latest?.downloadUrl || layer?.uploadedPermitDocs?.[t.id] || null;
          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                background: "rgba(0,0,0,0.2)",
                padding: "6px 8px",
                borderRadius: 4,
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700 }}>{t.label}</span>
                <span style={{ fontSize: 9, color: statusColor(String(statusVal)), fontWeight: 700 }}>
                  ● {statusVal}
                  {latest?.parsed?.permitNumber
                    ? ` · #${latest.parsed.permitNumber}`
                    : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                {docUrl ? (
                  <a
                    href={docUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: "rgba(33,150,243,0.2)",
                      border: "1px solid #2196F3",
                      color: "#2196F3",
                      fontSize: 9,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 3,
                      textDecoration: "none",
                    }}
                  >
                    VIEW
                  </a>
                ) : (
                  <span style={{ fontSize: 9, color: "#6b7280" }}>No file</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Upload controls */}
      <div
        style={{
          background: "rgba(0,230,118,0.06)",
          border: "1px solid rgba(0,230,118,0.25)",
          borderRadius: 6,
          padding: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: "#e2e8f0" }}>
          Upload permit for this job
        </span>
        <label style={{ fontSize: 9, color: "#94a3b8" }}>
          Permit type
          <select
            value={permitType}
            onChange={(e) => setPermitType(e.target.value as ZiplyPermitTypeKey)}
            disabled={busy}
            style={{
              display: "block",
              width: "100%",
              marginTop: 4,
              padding: "6px 8px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.35)",
              color: "#fff",
            }}
          >
            {ZIPLY_PERMIT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label
          style={{
            background: busy ? "rgba(255,255,255,0.06)" : "rgba(0,230,118,0.18)",
            border: "1px solid rgba(0,230,118,0.5)",
            color: "#00E676",
            fontSize: 10,
            fontWeight: 800,
            padding: "8px 12px",
            borderRadius: 4,
            cursor: busy ? "wait" : "pointer",
            textAlign: "center",
          }}
        >
          {busy ? `UPLOADING ${pct}%…` : "CHOOSE PDF / IMAGE & UPLOAD"}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*"
            disabled={busy}
            onChange={(ev) => void onUpload(ev)}
            style={{ display: "none" }}
          />
        </label>
        {msg && <span style={{ fontSize: 9, color: "#38bdf8" }}>{msg}</span>}
        {err && <span style={{ fontSize: 9, color: "#f87171" }}>{err}</span>}
      </div>

      {/* Ingested files with AI summary */}
      {permitFiles.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "#9ca3af",
              letterSpacing: "0.04em",
            }}
          >
            INGESTED PERMITS ({permitFiles.length})
          </span>
          {[...permitFiles]
            .sort((a, b) => b.uploadedAt - a.uploadedAt)
            .map((f) => {
              const p = f.parsed;
              return (
                <div
                  key={f.id}
                  style={{
                    background: "rgba(0,0,0,0.25)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 6,
                    padding: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#e2e8f0" }}>
                      {typeLabel(f.permitType)} · {f.name}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: statusColor(f.ingestStatus),
                      }}
                    >
                      {f.ingestStatus === "processing"
                        ? "READING…"
                        : f.ingestStatus === "complete"
                          ? "PARSED"
                          : "FAILED"}
                    </span>
                  </div>
                  {f.ingestStatus === "failed" && f.errorMessage && (
                    <p style={{ margin: 0, fontSize: 9, color: "#f87171" }}>{f.errorMessage}</p>
                  )}
                  {f.ingestStatus === "processing" && (
                    <p style={{ margin: 0, fontSize: 9, color: "#fbbf24" }}>
                      Gemini is extracting fields — wait a few seconds and the card will refresh.
                    </p>
                  )}
                  {p && (
                    <div style={{ fontSize: 9, color: "#cbd5e1", lineHeight: 1.45 }}>
                      {p.permitNumber && (
                        <div>
                          <strong>Permit #:</strong> {p.permitNumber}
                        </div>
                      )}
                      {p.issuingAgency && (
                        <div>
                          <strong>Agency:</strong> {p.issuingAgency}
                        </div>
                      )}
                      {(p.issueDate || p.expirationDate) && (
                        <div>
                          <strong>Dates:</strong>{" "}
                          {[p.issueDate && `issued ${p.issueDate}`, p.expirationDate && `exp ${p.expirationDate}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                      {(p.workStartDate || p.workEndDate || p.workHours) && (
                        <div>
                          <strong>Work window:</strong>{" "}
                          {[p.workStartDate, p.workEndDate, p.workHours].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {p.workLocation && (
                        <div>
                          <strong>Location:</strong> {p.workLocation}
                        </div>
                      )}
                      {p.streets && p.streets.length > 0 && (
                        <div>
                          <strong>Streets:</strong> {p.streets.join(", ")}
                        </div>
                      )}
                      {p.excavationMethods && p.excavationMethods.length > 0 && (
                        <div>
                          <strong>Methods:</strong> {p.excavationMethods.join(", ")}
                        </div>
                      )}
                      {p.trafficControlRequired != null && (
                        <div>
                          <strong>TCP required:</strong> {p.trafficControlRequired ? "Yes" : "No"}
                        </div>
                      )}
                      {p.conditions && p.conditions.length > 0 && (
                        <div>
                          <strong>Conditions:</strong> {p.conditions.slice(0, 4).join(" · ")}
                          {p.conditions.length > 4 ? ` (+${p.conditions.length - 4} more)` : ""}
                        </div>
                      )}
                      {p.restrictions && p.restrictions.length > 0 && (
                        <div>
                          <strong>Restrictions:</strong> {p.restrictions.slice(0, 3).join(" · ")}
                        </div>
                      )}
                      {p.summary && (
                        <div style={{ marginTop: 4, color: "#94a3b8", fontStyle: "italic" }}>
                          {p.summary}
                        </div>
                      )}
                    </div>
                  )}
                  {f.downloadUrl && (
                    <a
                      href={f.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-block",
                        marginTop: 6,
                        fontSize: 9,
                        color: "#38bdf8",
                        fontWeight: 700,
                      }}
                    >
                      Open file ↗
                    </a>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Ziply engineering print inventory + upload (not Lumen markups).
// -----------------------------------------------------------------------------
function ZiplyPrintDocsSection({ job }: { job: Job }) {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhanceMsg, setEnhanceMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const status = getZiplyPrintDocStatus(job);
  const files = listZiplyPrintFiles(job);
  const layer = job.ziplyPrintLayer;
  const terminalCount = layer?.mapObjects?.terminals?.length ?? layer?.terminalCount ?? null;
  const cableCount = layer?.mapObjects?.cables?.length ?? null;
  const dropCount = layer?.mapObjects?.dropSites?.length ?? null;
  const mapReady = isZiplyPrintMapReady(job);
  const anchor = getZiplyPrintAnchor(job);
  const enhancedAt = layer?.printGeometryEnhancedAt ?? null;

  const repairLocation = async () => {
    setRepairBusy(true);
    setErr(null);
    setEnhanceMsg(null);
    try {
      const r = await api.repairZiplyPrint(job.jobId);
      if (r.enhanced === false && r.reason === "geocode_failed") {
        setErr("Could not geocode address — check job address/city.");
      } else if (r.enhanced) {
        setEnhanceMsg(
          `CAD enhanced: ${r.cablesPathed ?? 0} paths · ${r.dropsPlaced ?? 0} drops`
        );
      }
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Repair failed");
    } finally {
      setRepairBusy(false);
    }
  };

  const enhanceCad = async () => {
    setEnhanceBusy(true);
    setErr(null);
    setEnhanceMsg(null);
    try {
      const r = await api.enhanceZiplyPrint(job.jobId);
      if (!r.enhanced) {
        setErr(
          r.reason === "geocode_failed"
            ? "Could not geocode for CAD enhance — check address/city."
            : r.reason || "Enhance failed"
        );
      } else {
        setEnhanceMsg(
          `CAD detail: ${r.cablesPathed} cable paths · ${r.terminalsGeocoded} terminals · ${r.dropsPlaced} drops · ${r.waypointsGeocoded} street waypoints`
        );
      }
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Enhance failed");
    } finally {
      setEnhanceBusy(false);
    }
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setPct(0);
    setErr(null);
    try {
      await ingestZiplyPrintForJob(job.jobId, file, (p) => setPct(Math.round(p)));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Upload failed");
    } finally {
      setBusy(false);
      setPct(0);
    }
  };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
      <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#00E676", margin: "0 0 8px 0" }}>
        🗺️ ENGINEERING PRINT
      </h4>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
          background: "rgba(0,0,0,0.2)",
          padding: 8,
          borderRadius: 4,
          border: "1px solid rgba(0,230,118,0.2)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: ziplyPrintStatusColor(status) }}>
            ● {ziplyPrintStatusLabel(status)}
          </span>
          {status === "ready" && (
            <span style={{ fontSize: 9, color: "#9ca3af" }}>
              {layer?.hubId ? `Hub ${layer.hubId}` : "Hub —"}
              {terminalCount != null ? ` · ${terminalCount} terminals` : ""}
              {cableCount != null ? ` · ${cableCount} cables` : ""}
              {dropCount != null && dropCount > 0 ? ` · ${dropCount} drops` : ""}
              {mapReady
                ? ` · map @ ${anchor!.lat.toFixed(4)}, ${anchor!.lng.toFixed(4)}`
                : " · NOT ON MAP (no lat/lng)"}
              {enhancedAt
                ? ` · CAD enhanced ${new Date(enhancedAt).toLocaleDateString()}`
                : mapReady
                  ? " · CAD not enhanced yet"
                  : ""}
            </span>
          )}
          {status === "ready" && !mapReady && (
            <span style={{ fontSize: 9, color: "#fbbf24" }}>
              Print data is saved but has no location. Use Repair location (no re-upload needed).
            </span>
          )}
          {status === "ready" && mapReady && !enhancedAt && (
            <span style={{ fontSize: 9, color: "#38bdf8" }}>
              Run ENHANCE CAD for multi-point cable paths + geocoded drops (lot-level detail).
            </span>
          )}
          {status === "failed" && job.ziplyIngest?.errorMessage && (
            <span style={{ fontSize: 9, color: "#f87171" }}>{job.ziplyIngest.errorMessage}</span>
          )}
          {busy && (
            <span style={{ fontSize: 9, color: "#38bdf8" }}>Uploading / starting ingest… {pct}%</span>
          )}
          {enhanceMsg && <span style={{ fontSize: 9, color: "#00E676" }}>{enhanceMsg}</span>}
          {err && <span style={{ fontSize: 9, color: "#f87171" }}>{err}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          {layer?.mapObjects && !mapReady && (
            <button
              type="button"
              disabled={repairBusy || busy || enhanceBusy}
              onClick={() => void repairLocation()}
              style={{
                background: "rgba(251,191,36,0.2)",
                border: "1px solid rgba(251,191,36,0.55)",
                color: "#fbbf24",
                fontSize: 9,
                fontWeight: 700,
                padding: "6px 10px",
                borderRadius: 4,
                cursor: repairBusy ? "wait" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {repairBusy ? "REPAIRING…" : "REPAIR LOCATION"}
            </button>
          )}
          {layer?.mapObjects && mapReady && (
            <button
              type="button"
              disabled={enhanceBusy || busy || repairBusy}
              onClick={() => void enhanceCad()}
              title="Geocode terminals/addresses and rebuild multi-point cable paths + drops on the map"
              style={{
                background: enhancedAt ? "rgba(8,145,178,0.18)" : "rgba(56,189,248,0.22)",
                border: "1px solid rgba(56,189,248,0.55)",
                color: "#38bdf8",
                fontSize: 9,
                fontWeight: 700,
                padding: "6px 10px",
                borderRadius: 4,
                cursor: enhanceBusy ? "wait" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {enhanceBusy ? "ENHANCING CAD…" : enhancedAt ? "RE-ENHANCE CAD" : "ENHANCE CAD DETAIL"}
            </button>
          )}
          <label
            style={{
              background: busy ? "rgba(255,255,255,0.06)" : "rgba(0,230,118,0.15)",
              border: "1px solid rgba(0,230,118,0.45)",
              color: "#00E676",
              fontSize: 9,
              fontWeight: 700,
              padding: "6px 10px",
              borderRadius: 4,
              cursor: busy ? "wait" : "pointer",
              whiteSpace: "nowrap",
              textAlign: "center",
            }}
          >
            {busy ? `${pct}%` : "UPLOAD PRINT"}
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*"
              disabled={busy}
              onChange={(ev) => void onPick(ev)}
              style={{ display: "none" }}
            />
          </label>
        </div>
      </div>
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.04em" }}>
            FILES FOR THIS JOB
          </span>
          {files.map((f, i) => (
            <div
              key={i}
              style={{
                fontSize: 10,
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "4px 6px",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 3,
              }}
            >
              {f.downloadUrl ? (
                <a
                  href={f.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#38bdf8", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {f.name}
                </a>
              ) : (
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
              )}
              <span style={{ color: "#6b7280", flexShrink: 0 }}>{formatBytes(f.size)}</span>
            </div>
          ))}
        </div>
      )}
      {files.length === 0 && status === "none" && (
        <p style={{ margin: 0, fontSize: 9, color: "#6b7280", lineHeight: 1.4 }}>
          No engineering print uploaded for this work order yet. Upload a PDF/image to build the
          design layer on the map.
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 811 expiration pill — surfaces a filed/active dig ticket that is expiring
// within 7 days. Clicking it jumps to the 811 tab, selects the ticket, and
// opens the ITIC modal (same nsc:lumina:openDigTicket contract the Lumina
// startDigTicket tool uses; sessionStorage flag survives the tab switch).
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
        marginLeft: 6,
        background: bg,
        color,
        border: "none",
        cursor: "pointer",
        fontWeight: 700,
      }}
    >
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Secondary-status pill: click to open a dropdown of all valid options.
// -----------------------------------------------------------------------------
function SecondaryStatusEditablePill({
  status,
  options,
  onChange,
  saving,
  saved,
  error,
}: {
  status: string;
  options: string[];
  onChange: (v: string) => void;
  saving: boolean;
  saved: boolean;
  error: boolean;
}) {
  const [open, setOpen] = useState(false);
  const key = colorKeyForSecondaryStatus(status || "");
  const color = MARKER_COLORS[key];
  const display = status || "Set status";

  return (
    <span style={{ position: "relative", display: "inline-block", marginLeft: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Click to change secondary status"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 8px",
          borderRadius: 10,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          background: `${color.core}22`,
          border: `1px solid ${color.core}`,
          color: "#1a1a1a",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color.core,
            boxShadow: `0 0 4px ${color.glow}`,
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        {display}
        <span style={{ opacity: 0.7, fontSize: 8 }}>▾</span>
      </button>
      <SaveIndicator saving={saving} saved={saved} error={error} inline />
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              zIndex: 1001,
              minWidth: 200,
              maxHeight: 280,
              overflowY: "auto",
              background: "#0f1623",
              border: "1px solid #2a3a55",
              borderRadius: 6,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              padding: 4,
            }}
          >
            {options.length === 0 && (
              <div style={{ padding: 8, fontSize: 10, color: "#93d4ff" }}>
                Loading options…
              </div>
            )}
            {options.map((opt) => {
              const isCurrent = opt === status;
              const ck = colorKeyForSecondaryStatus(opt);
              const c = MARKER_COLORS[ck];
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "5px 8px",
                    background: isCurrent ? "rgba(147,212,255,0.12)" : "transparent",
                    border: "none",
                    color: "#e6f0ff",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(147,212,255,0.18)")}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = isCurrent
                      ? "rgba(147,212,255,0.12)"
                      : "transparent")
                  }
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: c.core,
                      boxShadow: `0 0 4px ${c.glow}`,
                      flexShrink: 0,
                    }}
                  />
                  {opt}
                </button>
              );
            })}
          </div>
        </>
      )}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Generic editable row — click value to enter edit mode.
// -----------------------------------------------------------------------------
function EditableRow({
  label,
  value,
  type,
  options,
  toggleValue,
  onChange,
  onToggle,
  saving,
  saved,
  error,
}: {
  label: string;
  value: string;
  type: "select" | "date" | "toggle";
  options?: string[];
  toggleValue?: boolean;
  onChange?: (v: string) => void;
  onToggle?: (v: boolean) => void;
  saving: boolean;
  saved: boolean;
  error: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="job-card__row job-card__row--editable">
      <span className="job-card__row-label">{label}</span>
      {type === "toggle" ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              color: toggleValue ? "#c25000" : "var(--text-secondary)",
            }}
          >
            <input
              type="checkbox"
              checked={!!toggleValue}
              onChange={(e) => onToggle && onToggle(e.target.checked)}
              style={{ accentColor: "#ff6b00", cursor: "pointer" }}
            />
            {toggleValue ? "Required" : "Not required"}
          </label>
          <SaveIndicator saving={saving} saved={saved} error={error} inline />
        </span>
      ) : editing ? (
        type === "select" ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <select
              autoFocus
              value={value}
              onChange={(e) => {
                onChange && onChange(e.target.value);
                setEditing(false);
              }}
              onBlur={() => setEditing(false)}
              style={{
                background: "#0f1623",
                color: "#e6f0ff",
                border: "1px solid #2a3a55",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: 11,
                maxWidth: 200,
              }}
            >
              <option value="">— none —</option>
              {(options || []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <SaveIndicator saving={saving} saved={saved} error={error} inline />
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              autoFocus
              type="date"
              value={value || ""}
              onChange={(e) => {
                onChange && onChange(e.target.value);
              }}
              onBlur={() => setEditing(false)}
              style={{
                background: "#0f1623",
                color: "#e6f0ff",
                border: "1px solid #2a3a55",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: 11,
              }}
            />
            <SaveIndicator saving={saving} saved={saved} error={error} inline />
          </span>
        )
      ) : (
        <span
          className="job-card__row-value"
          onClick={() => setEditing(true)}
          title="Click to edit"
          style={{
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            minWidth: value ? undefined : 110,
            padding: value ? undefined : "3px 10px",
            borderRadius: value ? undefined : 6,
            border: value ? undefined : "1px dashed rgba(0,132,212,0.6)",
            background: value ? undefined : "rgba(30,167,255,0.14)",
            borderBottom: value ? "1px dotted rgba(0,132,212,0.45)" : undefined,
            color: value ? undefined : "#1a1a1a",
            fontSize: value ? undefined : 11,
            fontWeight: value ? undefined : 700,
            textTransform: value ? undefined : "uppercase",
            letterSpacing: value ? undefined : "0.06em",
          }}
        >
          {value || "TAP TO SET ▾"}
          <SaveIndicator saving={saving} saved={saved} error={error} inline />
        </span>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// EditableNotes — textarea that commits on blur.
// -----------------------------------------------------------------------------
function EditableNotes({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <div
        className="job-card__notes-body"
        onClick={() => setEditing(true)}
        title="Click to edit"
        style={{
          cursor: "pointer",
          minHeight: 24,
          borderBottom: "1px dotted rgba(0,132,212,0.35)",
          color: value ? undefined : "var(--text-muted)",
        }}
      >
        {value || <em>Click to add notes…</em>}
      </div>
    );
  }
  return (
    <textarea
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onCommit(draft);
      }}
      rows={3}
      style={{
        width: "100%",
        background: "#0f1623",
        color: "#e6f0ff",
        border: "1px solid #2a3a55",
        borderRadius: 4,
        padding: 6,
        fontSize: 11,
        fontFamily: "inherit",
        resize: "vertical",
      }}
    />
  );
}

// -----------------------------------------------------------------------------
// Save indicator dot.
// -----------------------------------------------------------------------------
function SaveIndicator({
  saving,
  saved,
  error,
  inline,
}: {
  saving: boolean;
  saved: boolean;
  error: boolean;
  inline?: boolean;
}) {
  if (!saving && !saved && !error) return null;
  const color = error ? "#ef4444" : saved ? "#16a34a" : "#f59e0b";
  const text = error ? "ERR" : saved ? "✓" : "…";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 9,
        fontWeight: 700,
        color,
        marginLeft: inline ? 4 : 0,
      }}
      title={error ? "Save failed" : saved ? "Saved" : "Saving…"}
    >
      {text}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="job-card__row">
      <span className="job-card__row-label">{label}</span>
      <span className="job-card__row-value">{value}</span>
    </div>
  );
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  return d;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
