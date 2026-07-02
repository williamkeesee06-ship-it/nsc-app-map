// Detail view for one dig ticket: shape stats, editable marking instructions
// (Gemini-generated, regenerable), hazards + safe guidelines, the utility
// response panel, status transitions, and the renewal flow.
import { useState } from "react";
import type { DigTicket, DigTicketStatus, Job, UtilityStatus } from "@nsc/types";
import { canDeleteDigTicket } from "@nsc/types";
import { api } from "../../lib/api.js";
import { statusColor, utilityStatusColor, UTILITY_STATUS_OPTIONS } from "./ticketStyle.js";

interface Props {
  ticket: DigTicket;
  job: Job | null;
  onUpdated: (t: DigTicket) => void;
  onDeleted: (ticketId: string) => void;
  onOpenJob: (job: Job) => void;
}

// Forward status transitions available from each state (the ITIC bot / poller
// drives some automatically; this is the manual override path).
const NEXT_STATUS: Partial<Record<DigTicketStatus, DigTicketStatus[]>> = {
  Drafting: ["Filing", "Review"],
  Review: ["Filing", "Filed"],
  Filing: ["Filed", "Failed"],
  Filed: ["Active"],
  Active: ["Expiring", "Expired"],
  Expiring: ["Expired", "Active"],
  Expired: ["Filing"],
  Failed: ["Filing"],
};

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function TicketDetail({ ticket, job, onUpdated, onDeleted, onOpenJob }: Props) {
  const [marking, setMarking] = useState(ticket.markingInstructions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset local edit buffer when a different ticket loads.
  const [lastId, setLastId] = useState(ticket.id);
  if (lastId !== ticket.id) {
    setLastId(ticket.id);
    setMarking(ticket.markingInstructions);
  }

  const run = async (label: string, fn: () => Promise<DigTicket>) => {
    setBusy(label);
    setError(null);
    try {
      onUpdated(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed: ${label}`);
    } finally {
      setBusy(null);
    }
  };

  const saveMarking = () =>
    run("save", async () => {
      const { ticket: t } = await api.updateDigTicket(ticket.id, { markingInstructions: marking });
      return t;
    });

  const regenerate = () =>
    run("regen", async () => {
      const { ticket: t } = await api.regenerateMarkingInstructions(ticket.id);
      setMarking(t.markingInstructions);
      return t;
    });

  const transition = (status: DigTicketStatus) =>
    run("status", async () => {
      const { ticket: t } = await api.updateDigTicket(ticket.id, { status });
      return t;
    });

  const setUtility = (utility: string, status: UtilityStatus["status"]) =>
    run(`util-${utility}`, async () => {
      const { ticket: t } = await api.updateUtilityStatus(ticket.id, { utility, status });
      return t;
    });

  // ITIC automation runs as a Firebase Function and mutates the ticket in
  // Firestore; the callables return summary data, so we re-fetch to get the
  // authoritative ticket back into local state.
  const refetch = async () => (await api.getDigTicket(ticket.id)).ticket;

  const runBot = () =>
    run("bot", async () => {
      await api.runIticBot(ticket.id);
      return refetch();
    });

  const checkResponses = () =>
    run("check", async () => {
      await api.checkTicketResponses(ticket.id);
      return refetch();
    });

  const deletable = canDeleteDigTicket(ticket);

  const deleteTicket = async () => {
    const label = job?.workOrder || ticket.ticketNumber || ticket.jobId;
    if (!window.confirm(`Delete ticket ${label}? This cannot be undone.`)) return;
    setBusy("delete");
    setError(null);
    try {
      await api.deleteDigTicket(ticket.id);
      onDeleted(ticket.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete ticket");
      setBusy(null);
    }
  };

  const guidelines = ticket.safeGuidelines
    ? ticket.safeGuidelines.split("\n").filter(Boolean)
    : [];

  return (
    <div className="dt-view">
      <header className="dt-view__head">
        <div>
          <h2 className="dt-view__title">
            {job?.workOrder ?? ticket.jobId}
            {job && (
              <button className="dt-link" onClick={() => onOpenJob(job)}>
                open on map
              </button>
            )}
          </h2>
          <div className="dt-view__sub">
            {ticket.ticketNumber || "Not filed with ITIC yet"} · Created {fmtDate(ticket.dates.createdAt)}
          </div>
          {ticket.ticketNumber && (
            <div className="dt-filed-banner">
              <span className="dt-filed-banner__num">ITIC #{ticket.ticketNumber}</span>
              <span className="dt-filed-banner__exp">Expires {fmtDate(ticket.dates.expiresAt)}</span>
            </div>
          )}
        </div>
        <div className="dt-view__head-right">
          <span className="dt-ticket__status" style={{ background: statusColor(ticket.status) }}>
            {ticket.status}
          </span>
          {deletable && (
            <button
              className="dt-btn dt-btn--sm dt-btn--delete"
              onClick={() => void deleteTicket()}
              disabled={busy === "delete"}
            >
              {busy === "delete" ? "Deleting…" : "Delete ticket"}
            </button>
          )}
        </div>
      </header>

      {error && <div className="dt-error">{error}</div>}

      {/* Shape + specs */}
      <section className="dt-card">
        <div className="dt-card__title">EXCAVATION SHAPE</div>
        <div className="dt-stats">
          <div><span>Type</span><b>{ticket.shape.type}</b></div>
          <div><span>Area</span><b>{Math.round(ticket.shape.areaSqFt).toLocaleString()} ft²</b></div>
          <div><span>Perimeter</span><b>{Math.round(ticket.shape.perimeterFt).toLocaleString()} ft</b></div>
          <div><span>Work type</span><b>{ticket.specs.workType || "—"}</b></div>
          <div><span>Duration</span><b>{ticket.specs.duration} days</b></div>
        </div>
        <div className="dt-flags">
          {ticket.specs.handDigOnly && <span className="dt-chip">Hand dig only</span>}
          {ticket.specs.directionalBoring && <span className="dt-chip">Directional boring</span>}
          {ticket.specs.whiteLined && <span className="dt-chip">White-lined</span>}
          {ticket.specs.explosives && <span className="dt-chip dt-chip--warn">Explosives</span>}
          {ticket.specs.equipment.map((e) => <span key={e} className="dt-chip">{e}</span>)}
        </div>
      </section>

      {/* Marking instructions (editable + regenerate) */}
      <section className="dt-card">
        <div className="dt-card__title">
          MARKING INSTRUCTIONS
          <button className="dt-btn dt-btn--sm" onClick={regenerate} disabled={busy === "regen"}>
            {busy === "regen" ? "Regenerating…" : "↻ Regenerate (Gemini)"}
          </button>
        </div>
        <textarea
          className="dt-textarea"
          value={marking}
          onChange={(e) => setMarking(e.target.value)}
          rows={5}
          placeholder="Gemini-generated marking instructions will appear here."
        />
        <button
          className="dt-btn dt-btn--primary dt-btn--sm"
          onClick={saveMarking}
          disabled={busy === "save" || marking === ticket.markingInstructions}
        >
          {busy === "save" ? "Saving…" : "Save edits"}
        </button>
      </section>

      {/* ITIC automation: file with ITIC end-to-end (fill + auto-submit). */}
      <section className="dt-card">
        <div className="dt-card__title">ITIC AUTOMATION</div>
        <div className="dt-view__foot">
          <button
            className="dt-btn dt-btn--primary"
            onClick={runBot}
            disabled={busy === "bot"}
          >
            {busy === "bot" ? "Filing…" : "▶ File with ITIC"}
          </button>
        </div>
        {ticket.iticPdfUrl && (
          <a
            className="dt-link"
            href={ticket.iticPdfUrl}
            target="_blank"
            rel="noreferrer"
          >
            View ITIC PDF
          </a>
        )}
        {ticket.automation.reviewScreenshotUrl && (
          <a
            className="dt-link"
            href={ticket.automation.reviewScreenshotUrl}
            target="_blank"
            rel="noreferrer"
          >
            View review screenshot
          </a>
        )}
        {ticket.automation.confirmationScreenshotUrl && (
          <a
            className="dt-link"
            href={ticket.automation.confirmationScreenshotUrl}
            target="_blank"
            rel="noreferrer"
          >
            View confirmation screenshot
          </a>
        )}
        {ticket.automation.botErrors.length > 0 && (
          <div className="dt-error">{ticket.automation.botErrors.at(-1)}</div>
        )}
      </section>

      {ticket.hazardsWarning && (
        <section className="dt-card dt-card--hazard">
          <div className="dt-card__title">⚠ HAZARDS</div>
          <p>{ticket.hazardsWarning}</p>
        </section>
      )}

      {guidelines.length > 0 && (
        <section className="dt-card">
          <div className="dt-card__title">SAFE EXCAVATION GUIDELINES</div>
          <ul className="dt-guidelines">
            {guidelines.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </section>
      )}

      {/* Utility response panel */}
      <section className="dt-card">
        <div className="dt-card__title">
          UTILITY RESPONSES
          {ticket.readyToDig && <span className="dt-chip dt-chip--ready">READY TO DIG</span>}
          <button className="dt-btn dt-btn--sm" onClick={checkResponses} disabled={busy === "check"}>
            {busy === "check" ? "Checking…" : "↻ Check ITIC"}
          </button>
        </div>
        <div className="dt-util-panel">
          {ticket.utilityStatuses.map((u) => (
            <div key={u.utility} className="dt-util-row">
              <span className="dt-util-name">{u.utility}</span>
              <span className="dt-util-dot" style={{ background: utilityStatusColor(u.status) }} />
              <div className="dt-util-opts">
                {UTILITY_STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`dt-util-opt${u.status === s ? " dt-util-opt--on" : ""}`}
                    onClick={() => setUtility(u.utility, s)}
                    disabled={busy === `util-${u.utility}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="dt-view__sub">
          Last checked: {fmtDate(ticket.lastCheckedAt)}
        </div>
      </section>

      {/* Dates + renewal flow */}
      <section className="dt-card">
        <div className="dt-card__title">DATES</div>
        <div className="dt-stats">
          <div><span>Start (48hr)</span><b>{fmtDate(ticket.specs.startDate)}</b></div>
          <div><span>Submitted</span><b>{fmtDate(ticket.dates.submittedAt)}</b></div>
          <div><span>Active from</span><b>{fmtDate(ticket.dates.startsAt)}</b></div>
          <div><span>Expires</span><b>{fmtDate(ticket.dates.expiresAt)}</b></div>
        </div>
      </section>

      {/* Status transitions */}
      <footer className="dt-view__foot">
        {(NEXT_STATUS[ticket.status] ?? []).map((s) => (
          <button
            key={s}
            className={`dt-btn${s === "Failed" || s === "Expired" ? " dt-btn--danger" : " dt-btn--primary"}`}
            onClick={() => transition(s)}
            disabled={busy === "status"}
          >
            → {s}
          </button>
        ))}
        {ticket.status === "Expired" && (
          <span className="dt-view__sub">Renew by re-filing with ITIC (→ Filing).</span>
        )}
      </footer>
    </div>
  );
}
