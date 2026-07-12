// 811 LOCATE section — rendered in the JobsMap right rail directly above the
// LAYERS panel. Surfaces the current dig shape, its 811 ticket status, and
// expiration, with state-aware action buttons. All routes back to the 811 tab
// reuse the nsc:map:openDigTicketForJob bridge shipped in fec5e44 so the tab
// pre-loads this job. Styling mirrors the LAYERS panel: same divider, same
// 10px/700/uppercase header treatment.
import { useEffect, useState, type ReactNode } from "react";
import type { DigShape, DigTicket, Job } from "@nsc/types";
import { api } from "../../lib/api.js";
import { useDigPolygon } from "../dig-polygon/digPolygonContext.js";

import { useAuth } from "../auth/authContext.js";

const DIG_DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_TICKET_STATUSES = new Set<DigTicket["status"]>(["Filed", "Active", "Expiring"]);

// Route to the 811 tab for a given job (mirrors DigPolygonOverlay's Save & Open 811).
function openDigTicketForJob(jobId: string) {
  try {
    sessionStorage.setItem("nsc.map.openDigTicketForJob", JSON.stringify({ jobId }));
  } catch {
    /* ignore disabled storage */
  }
  window.dispatchEvent(new CustomEvent("nsc:map:openDigTicketForJob", { detail: { jobId } }));
  window.dispatchEvent(new CustomEvent("nsc:request-tab", { detail: { tab: "811-tickets" } }));
}

function shapeTypeLabel(t: DigShape["type"]): string {
  return t === "radius" ? "Radius" : t === "route" ? "Route" : "Polygon";
}

export default function Eight11Section({ job }: { job: Job }) {
  const { existing, setTool } = useDigPolygon();
  const [ticket, setTicket] = useState<DigTicket | null>(null);
  const [copying, setCopying] = useState(false);
  const { username, isManager } = useAuth();

  useEffect(() => {
    let cancelled = false;
    const owner = isManager ? "*" : username || "";
    api
      .listDigTickets(owner)
      .then(({ tickets }) => {
        if (cancelled) return;
        const byActive = job.activeTicketId
          ? tickets.find((t) => t.id === job.activeTicketId)
          : undefined;
        setTicket(byActive ?? tickets.find((t) => t.jobId === job.jobId) ?? null);
      })
      .catch(() => {
        if (!cancelled) setTicket(null);
      });
    return () => {
      cancelled = true;
    };
  }, [job.jobId, job.activeTicketId, username, isManager]);

  // The shape we summarise: prefer the live job shape, fall back to the ticket
  // snapshot (e.g. shape was cleared on the job but the ticket still holds one).
  const shape: DigShape | null = existing ?? ticket?.shape ?? (job.digPolygon as DigShape) ?? null;
  const expiresAt = ticket?.dates.expiresAt ?? job.locateExpires ?? null;
  const ticketNumber = ticket?.ticketNumber ?? job.locateNumber ?? null;
  const daysLeft = expiresAt != null ? Math.floor((expiresAt - Date.now()) / DIG_DAY_MS) : null;
  const status = ticket?.status ?? (expiresAt != null ? (expiresAt < Date.now() ? "Expired" : (expiresAt < Date.now() + 7 * DIG_DAY_MS ? "Expiring" : "Active")) : undefined);

  // Determine which of the four states we're in.
  type State = "A" | "B" | "C" | "D";
  let state: State;
  if (!shape) state = "A";
  else if (status === "Expired") state = "D";
  else if (status && (LIVE_TICKET_STATUSES.has(status) || status === "Active" || status === "Expiring")) state = "C";
  else state = "B";

  // Header pill (label + colors) per state.
  let pillLabel: string;
  let pillBg: string;
  let pillColor: string;
  if (state === "A") {
    pillLabel = "NO LOCATE";
    pillBg = "#3a3a3a";
    pillColor = "#e0e0e0";
  } else if (state === "B") {
    pillLabel = "READY TO FILE";
    pillBg = "#ff9a3a";
    pillColor = "#1a1a1a";
  } else if (state === "D") {
    pillLabel = "EXPIRED";
    pillBg = "#ff2d4a";
    pillColor = "#fafafa";
  } else if (daysLeft != null && daysLeft <= 0) {
    pillLabel = "EXPIRES TODAY";
    pillBg = "#ff7043";
    pillColor = "#fafafa";
  } else if (status === "Expiring" || (daysLeft != null && daysLeft <= 7)) {
    pillLabel = `EXPIRING ${daysLeft}d`;
    pillBg = "#ffb300";
    pillColor = "#1a1a1a";
  } else {
    pillLabel = "ACTIVE";
    pillBg = "#1d4ed8";
    pillColor = "#0a1a0f";
  }

  const redrawType: DigShape["type"] = shape?.type ?? "radius";

  const handleCopyInstructions = async () => {
    setCopying(true);
    try {
      const res = await fetch(`/api/jobs/${job.jobId}/marking-instructions`, { method: "POST" });
      const data = await res.json();
      if (data.instructions) {
        await navigator.clipboard.writeText(data.instructions);
        // Visual feedback could be a toast, for now alert
        alert("Marking instructions copied to clipboard!");
      }
    } catch (err) {
      alert("Failed to copy marking instructions.");
    }
    setCopying(false);
  };

  return (
    <section
      style={{
        marginTop: 0,
        paddingTop: 0,
        borderTop: "none",
      }}
    >
      {status === "Expired" && (
        <div style={{
          background: "rgba(255,45,74,0.08)",
          border: "1.2px dashed #ff2d4a",
          borderRadius: 6,
          padding: "8px 10px",
          marginBottom: 12,
          color: "#ff2d4a",
          fontSize: 11,
          fontWeight: 700,
          lineHeight: "1.3em",
          boxShadow: "0 0 8px rgba(255,45,74,0.15)",
        }}>
          ⚠️ LOCATE TICKET EXPIRED! Call in new 811 dig tickets 72 hours prior to excavation.
        </div>
      )}
      {status === "Expiring" && (
        <div style={{
          background: "rgba(255,179,0,0.08)",
          border: "1.2px dashed #ffb300",
          borderRadius: 6,
          padding: "8px 10px",
          marginBottom: 12,
          color: "#ffb300",
          fontSize: 11,
          fontWeight: 700,
          lineHeight: "1.3em",
        }}>
          ⚠️ LOCATE TICKET EXPIRING SOON! ({daysLeft} days remaining). Please renew promptly.
        </div>
      )}
      {/* Header — mirrors LAYERS: 10px / 700 / uppercase + right-side pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 2px 8px",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          811 Locate
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: "3px 10px",
            borderRadius: 999,
            background: pillBg,
            color: pillColor,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {pillLabel}
        </span>
      </div>

      {/* ── Progress Track (#1) ── */}
      {state !== "A" && (
        <div style={{ padding: "4px 2px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          {/* Track Line & Dots */}
          <div style={{ position: "relative", height: 16, display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 10px" }}>
            {/* Background line */}
            <div style={{ position: "absolute", left: 0, right: 0, height: 2, background: "rgba(255,255,255,0.08)", zIndex: 1 }} />
            
            {/* Active filled line */}
            <div 
              style={{ 
                position: "absolute", 
                left: 0, 
                width: 
                  state === "B" ? "0%" : 
                  ticket?.readyToDig ? "100%" :
                  state === "D" ? "100%" :
                  status === "Active" || status === "Expiring" ? "75%" : "25%", 
                height: 2, 
                background: 
                  state === "D" ? "#ff2d4a" :
                  ticket?.readyToDig ? "#3ecf6b" :
                  status === "Active" || status === "Expiring" ? "#1ea7ff" : "#ff9a3a", 
                boxShadow: 
                  state === "D" ? "0 0 6px #ff2d4a" :
                  ticket?.readyToDig ? "0 0 6px #3ecf6b" :
                  status === "Active" || status === "Expiring" ? "0 0 6px #1ea7ff" : "0 0 6px #ff9a3a",
                zIndex: 2,
                transition: "all 0.3s ease"
              }} 
            />

            {/* Nodes */}
            {[
              { label: "Draft", active: true, color: "#ff9a3a" },
              { label: "Filed", active: state !== "B", color: "#ffb300" },
              { label: "Active", active: status === "Active" || status === "Expiring" || ticket?.readyToDig || state === "D", color: "#1ea7ff" },
              { label: "Ready", active: !!ticket?.readyToDig, color: "#3ecf6b" },
              { label: "Done", active: state === "D", color: state === "D" ? "#ff2d4a" : "#8e96a0" }
            ].map((node, index) => {
              const glow = node.active ? `0 0 8px ${node.color}` : "none";
              return (
                <div 
                  key={index} 
                  style={{ 
                    width: 8, 
                    height: 8, 
                    borderRadius: "50%", 
                    background: node.active ? node.color : "#3a3a3a", 
                    boxShadow: glow,
                    zIndex: 3, 
                    position: "relative",
                    transition: "all 0.3s ease"
                  }} 
                  title={node.label}
                />
              );
            })}
          </div>

          {/* Labels under track */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, fontWeight: 700, color: "#6a7580", textTransform: "uppercase", padding: "0 2px" }}>
            <span>Draft</span>
            <span>Filed</span>
            <span>Active</span>
            <span>Ready</span>
            <span>Done</span>
          </div>
        </div>
      )}

      {/* Body */}
      {state === "A" ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "2px 2px 8px" }}>
          No dig shape drawn yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "2px 2px 8px" }}>
          {shape && (
            <Eight11Line icon="●" iconColor="#ff6a00" label="SHAPE">
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {shapeTypeLabel(shape.type)} · {Math.round(shape.areaSqFt).toLocaleString()} ft² ·{" "}
                {Math.round(shape.perimeterFt).toLocaleString()} ft perimeter
              </span>
            </Eight11Line>
          )}

          {state === "B" && (
            <Eight11Line icon="⚠" iconColor="#c25000" label="TICKET">
              Not filed yet
            </Eight11Line>
          )}

          {(state === "C" || state === "D") && (
            <>
              <Eight11Line icon="◆" iconColor="#0084d4" label="TICKET">
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  ITIC #{ticketNumber || "— not filed —"}
                </span>
              </Eight11Line>
              <Eight11Line icon="◷" iconColor={state === "D" ? "#c23a00" : "var(--text-muted)"} label="EXPIRES">
                {daysLeft != null && expiresAt != null ? (
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {state === "D"
                      ? `${Math.abs(daysLeft)} days ago`
                      : `${daysLeft} days`}{" "}
                    · {shortDate(expiresAt)}
                  </span>
                ) : (
                  "—"
                )}
              </Eight11Line>

              {/* Utility Locator Responses Dashboard HUD (#3) */}
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid rgba(200,208,218,0.08)", paddingTop: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#6a7580", textTransform: "uppercase" }}>
                  Locator Responses
                </div>
                
                {ticket?.utilityStatuses && ticket.utilityStatuses.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
                    {ticket.utilityStatuses.map((ut, idx) => {
                      const statusColors = {
                        clear: { border: "rgba(62,207,107,0.8)", bg: "rgba(62,207,107,0.15)", text: "#3ecf6b", icon: "✓", glow: "rgba(62,207,107,0.3)" },
                        marked: { border: "rgba(62,207,107,0.8)", bg: "rgba(62,207,107,0.15)", text: "#3ecf6b", icon: "✓", glow: "rgba(62,207,107,0.3)" },
                        pending: { border: "rgba(255,165,0,0.8)", bg: "rgba(255,165,0,0.15)", text: "#ffa500", icon: "◷", glow: "rgba(255,165,0,0.3)" },
                        "in-progress": { border: "rgba(255,165,0,0.8)", bg: "rgba(255,165,0,0.15)", text: "#ffa500", icon: "◷", glow: "rgba(255,165,0,0.3)" },
                        conflict: { border: "rgba(255,45,74,0.8)", bg: "rgba(255,45,74,0.15)", text: "#ff2d4a", icon: "⚠", glow: "rgba(255,45,74,0.3)" },
                      }[ut.status] || { border: "rgba(255,255,255,0.3)", bg: "rgba(255,255,255,0.05)", text: "#c8d0da", icon: "?", glow: "rgba(255,255,255,0.1)" };

                      return (
                        <div 
                          key={idx}
                          style={{
                            background: statusColors.bg,
                            border: `1.2px solid ${statusColors.border}`,
                            borderRadius: 5,
                            padding: "5px 7px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                            boxShadow: `0 0 8px ${statusColors.glow}`,
                            transition: "all 0.2s ease"
                          }}
                        >
                        <span style={{ fontSize: 9, fontWeight: 700, color: "#f4f8ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={ut.utility}>
                          {ut.utility}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 8, fontWeight: 700, color: statusColors.text, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          <span style={{ fontSize: 10 }}>{statusColors.icon}</span>
                          <span>{ut.status}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", marginTop: 4 }}>
                  Awaiting locator responses...
                </div>
              )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 2 }}>
        {state === "A" && (
          <Eight11Button variant="primary" onClick={() => setTool("radius")}>
            Draw Shape
          </Eight11Button>
        )}
        {state === "B" && (
          <>
            <Eight11Button variant="primary" onClick={() => openDigTicketForJob(job.jobId)}>
              Open 811 Ticket
            </Eight11Button>
            <Eight11Button variant="secondary" onClick={() => setTool(redrawType)}>
              Redraw Shape
            </Eight11Button>
            <Eight11Button variant="secondary" onClick={handleCopyInstructions}>
              {copying ? "Copying..." : "Copy Instructions"}
            </Eight11Button>
          </>
        )}
        {state === "C" && (
          <>
            <Eight11Button variant="primary" onClick={() => openDigTicketForJob(job.jobId)}>
              Open Ticket
            </Eight11Button>
            <Eight11Button variant="secondary" onClick={() => setTool(redrawType)}>
              Redraw
            </Eight11Button>
            <Eight11Button variant="secondary" onClick={handleCopyInstructions}>
              {copying ? "Copying..." : "Copy Instructions"}
            </Eight11Button>
          </>
        )}
        {state === "D" && (
          <>
            <Eight11Button variant="primary" onClick={() => openDigTicketForJob(job.jobId)}>
              Renew Ticket
            </Eight11Button>
            <Eight11Button variant="secondary" onClick={() => setTool(redrawType)}>
              Redraw
            </Eight11Button>
            <Eight11Button variant="secondary" onClick={handleCopyInstructions}>
              {copying ? "Copying..." : "Copy Instructions"}
            </Eight11Button>
          </>
        )}
      </div>
    </section>
  );
}

// A single labelled body line: symbol + fixed-width label + value.
function Eight11Line({
  icon,
  iconColor,
  label,
  children,
}: {
  icon: string;
  iconColor: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13 }}>
      <span style={{ color: iconColor, flexShrink: 0, width: 12, textAlign: "center" }}>{icon}</span>
      <span
        style={{
          color: "var(--text-secondary)",
          fontWeight: 700,
          letterSpacing: "0.05em",
          fontSize: 9,
          textTransform: "uppercase",
          width: 52,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span style={{ color: "var(--text)", fontWeight: 500, flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

// Pill-style action button matching the JobCard's "Open in As-Built" treatment.
function Eight11Button({
  variant,
  onClick,
  children,
}: {
  variant: "primary" | "secondary";
  onClick: () => void;
  children: ReactNode;
}) {
  const primary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "6px 12px",
        borderRadius: 999,
        background: primary ? "rgba(255,106,0,0.14)" : "rgba(0,0,0,0.05)",
        border: primary ? "1px solid rgba(255,106,0,0.55)" : "1px solid var(--border)",
        color: primary ? "#c25000" : "var(--text-secondary)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function shortDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
