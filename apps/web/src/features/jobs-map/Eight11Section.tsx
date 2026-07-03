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

  useEffect(() => {
    let cancelled = false;
    api
      .listDigTickets()
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
  }, [job.jobId, job.activeTicketId]);

  // The shape we summarise: prefer the live job shape, fall back to the ticket
  // snapshot (e.g. shape was cleared on the job but the ticket still holds one).
  const shape: DigShape | null = existing ?? ticket?.shape ?? null;
  const status = ticket?.status;
  const expiresAt = ticket?.dates.expiresAt ?? null;
  const daysLeft = expiresAt != null ? Math.floor((expiresAt - Date.now()) / DIG_DAY_MS) : null;

  // Determine which of the four states we're in.
  type State = "A" | "B" | "C" | "D";
  let state: State;
  if (!shape) state = "A";
  else if (ticket && status === "Expired") state = "D";
  else if (ticket && status && LIVE_TICKET_STATUSES.has(status)) state = "C";
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
    pillBg = "#8b1a1a";
    pillColor = "#fafafa";
  } else if (daysLeft != null && daysLeft <= 0) {
    pillLabel = "EXPIRES TODAY";
    pillBg = "#ff7043";
    pillColor = "#fafafa";
  } else if (status === "Expiring" || (daysLeft != null && daysLeft <= 7)) {
    pillLabel = `EXPIRING ${daysLeft}d`;
    pillBg = "#ff7043";
    pillColor = "#fafafa";
  } else {
    pillLabel = "ACTIVE";
    pillBg = "#3ecf6b";
    pillColor = "#0a1a0f";
  }

  const redrawType: DigShape["type"] = shape?.type ?? "radius";

  return (
    <section
      style={{
        marginTop: 12,
        paddingTop: 10,
        borderTop: "1.5px solid var(--border)",
      }}
    >
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
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "1.2px",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          811 Locate
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: "2px 8px",
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

      {/* Body */}
      {state === "A" ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "2px 2px 8px" }}>
          No dig shape drawn yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "2px 2px 8px" }}>
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
                  ITIC #{ticket?.ticketNumber || "— not filed —"}
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
