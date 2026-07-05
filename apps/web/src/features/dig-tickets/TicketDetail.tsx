// Detail view for one dig ticket: shape stats, editable marking instructions
// (Gemini-generated, regenerable), hazards + safe guidelines, the utility
// response panel, status transitions, and the renewal flow.
import { useEffect, useState } from "react";
import type { DigTicket, DigTicketStatus, Job, UtilityStatus } from "@nsc/types";
import { canDeleteDigTicket } from "@nsc/types";
import { api } from "../../lib/api.js";
import { statusColor, utilityStatusColor, UTILITY_STATUS_OPTIONS } from "./ticketStyle.js";
import IticModal from "./IticModal.js";

interface Props {
  ticket: DigTicket;
  job: Job | null;
  onUpdated: (t: DigTicket) => void;
  onDeleted: (ticketId: string) => void;
  onOpenJob: (job: Job) => void;
  autoOpenIticModal?: boolean;
  onIticModalAcknowledged?: () => void;
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

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatMDY(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// Soonest allowed work-to-begin = today + N business days (weekends skipped).
// WA dig tickets are valid for 45 days from the work-to-begin date.
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d;
}

export default function TicketDetail({ ticket, job, onUpdated, onDeleted, onOpenJob, autoOpenIticModal, onIticModalAcknowledged }: Props) {
  const [marking, setMarking] = useState(ticket.markingInstructions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filedNumber, setFiledNumber] = useState(ticket.ticketNumber);
  const [notice, setNotice] = useState<string | null>(null);
  const [iticOpen, setIticOpen] = useState(false);

  // Reset local edit buffer when a different ticket loads.
  const [lastId, setLastId] = useState(ticket.id);
  // Lumina's startDigTicket tool can request this modal to open when the
  // ticket becomes the selected one. Ack back so the parent clears the flag.
  useEffect(() => {
    if (autoOpenIticModal) {
      setIticOpen(true);
      onIticModalAcknowledged?.();
    }
  }, [autoOpenIticModal, onIticModalAcknowledged]);
  if (lastId !== ticket.id) {
    setLastId(ticket.id);
    setMarking(ticket.markingInstructions);
    setFiledNumber(ticket.ticketNumber);
    setNotice(null);
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

  // ── Request 811 (human-in-the-loop) ──────────────────────────────────────
  // The fully-automated bot proved too fragile on ITIC's Google-Maps draw step,
  // so filing is now driven by hand inside an embedded ITIC iframe (IticModal).
  // The companion Chrome extension autofills login + address so ITIC opens
  // straight to the map; the user draws the shape → submits, then pastes the
  // assigned ticket number back here, which flips the ticket to Filed (firing
  // the onTicketFiled Smartsheet write-back).
  const jobAddress = [job?.address, job?.city, job?.zipCode].filter(Boolean).join(", ");
  // Work-to-begin = today + 2 business days (ITIC's 48hr notice). Computed here
  // so both saveFiledTicket and the extension payload agree on the date.
  const workToBeginDate = addBusinessDays(new Date(), 2);
  const workToBeginMDY = formatMDY(workToBeginDate);

  const saveFiledTicket = () =>
    run("save-filed", async () => {
      const num = filedNumber.trim();
      const now = Date.now();
      // Work-to-begin is today + 2 business days (ITIC's 48hr notice); the
      // locate is then valid for the ticket's 45-day WA lifespan.
      const startsAt = addBusinessDays(new Date(now), 2).getTime();
      const expiresAt = startsAt + ticket.specs.duration * DAY_MS;
      const { ticket: t } = await api.updateDigTicket(ticket.id, {
        ticketNumber: num,
        status: "Filed",
        dates: {
          createdAt: ticket.dates.createdAt,
          submittedAt: now,
          startsAt,
          expiresAt,
        },
      });
      setNotice(`Filed ITIC #${num}. Smartsheet write-back is in progress.`);
      return t;
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
      {iticOpen && (
        <IticModal
          ticket={ticket}
          job={job}
          jobAddress={jobAddress}
          markingInstructions={marking}
          workToBegin={workToBeginMDY}
          workToBeginMs={workToBeginDate.getTime()}
          filedNumber={filedNumber}
          onFiledNumberChange={setFiledNumber}
          onSaveFiled={saveFiledTicket}
          saving={busy === "save-filed"}
          onClose={() => setIticOpen(false)}
        />
      )}
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

      {ticket.readyToDig && (
        <div className="dt-status-banner dt-status-banner--success">
          <strong>✓ READY TO DIG</strong>
          <span>All member utilities have responded. White paint lines are verified.</span>
        </div>
      )}
      {ticket.status === "Expired" && (
        <div className="dt-status-banner dt-status-banner--danger">
          <strong>⚠ TICKET EXPIRED</strong>
          <span>Excavation is legally halted. Submit a renewal filing immediately.</span>
        </div>
      )}
      {ticket.status === "Failed" && (
        <div className="dt-status-banner dt-status-banner--danger">
          <strong>⚠ FILING FAILED</strong>
          <span>The automatic filing process failed. Please check bot logs and file manually.</span>
        </div>
      )}

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

      {/* Request 811: human-in-the-loop ITIC filing inside an embedded iframe
          (draw + submit in ITIC → paste ticket # back). */}
      <section className="dt-card">
        <div className="dt-card__title">REQUEST 811</div>
        <div className="dt-request811">
          <div className="dt-request811__summary">
            <div><span>Address</span><b>{jobAddress || "—"}</b></div>
            <div><span>Work type</span><b>{ticket.specs.workType || "—"}</b></div>
            <div><span>Work for</span><b>LUMEN</b></div>
            <div><span>Duration</span><b>45 days</b></div>
          </div>
          <button
            className="dt-btn dt-btn--primary"
            onClick={() => setIticOpen(true)}
          >
            Request 811
          </button>
          <div className="dt-request811__filed">
            <label className="dt-field">
              <span>Filed ticket #</span>
              <input
                value={filedNumber}
                onChange={(e) => setFiledNumber(e.target.value)}
                placeholder="Paste the ITIC ticket # after you submit"
              />
            </label>
            <button
              className="dt-btn dt-btn--primary dt-btn--sm"
              onClick={saveFiledTicket}
              disabled={busy === "save-filed" || filedNumber.trim() === ""}
            >
              {busy === "save-filed" ? "Saving…" : "Save filed ticket"}
            </button>
          </div>
          {notice && <div className="dt-request811__notice">{notice}</div>}
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
