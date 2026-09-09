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
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [extensionActive, setExtensionActive] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [botBusy, setBotBusy] = useState(false);

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Detect official chrome-extension/ "NSC 811 Autofill"
  useEffect(() => {
    const ping = setInterval(() => {
      window.postMessage({ type: "NSC_PING_811" }, window.location.origin);
    }, 1500);
    const listener = (e: MessageEvent) => {
      if (e.data?.type === "NSC_PONG_811" || e.data?.type === "NSC_PONG_EXTENSION") {
        setExtensionActive(true);
        clearInterval(ping);
      }
    };
    window.addEventListener("message", listener);
    window.postMessage({ type: "NSC_PING_811" }, window.location.origin);
    return () => {
      clearInterval(ping);
      window.removeEventListener("message", listener);
    };
  }, []);

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

  const refetch = async () => (await api.getDigTicket(ticket.id)).ticket;

  // Official extension success + legacy copilot message shape
  useEffect(() => {
    const saveNumber = async (numRaw: string) => {
      const num = String(numRaw).trim();
      if (!num) return;
      setFiledNumber(num);
      setNotice(`Locate #${num} from extension — saving…`);
      const now = Date.now();
      const startsAt = addBusinessDays(new Date(now), 2).getTime();
      const expiresAt = startsAt + ticket.specs.duration * DAY_MS;
      try {
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
        setNotice(`Filed ITIC #${num} successfully.`);
        onUpdated(t);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save ticket number");
      }
    };

    const handleExtensionMessage = (e: MessageEvent) => {
      if (e.data?.type === "NSC_811_FILED_SUCCESS" && e.data?.payload?.ticketNumber) {
        void saveNumber(e.data.payload.ticketNumber);
        return;
      }
      if (e.data?.type === "NSC_ITIC_FILING_COMPLETED" && e.data?.ticketNumber) {
        void saveNumber(e.data.ticketNumber);
      }
    };
    window.addEventListener("message", handleExtensionMessage);
    return () => window.removeEventListener("message", handleExtensionMessage);
  }, [ticket, onUpdated]);

  // ── Request 811 (Roadmap C) ────────────────────────────────────────────
  // Official path: chrome-extension/ "NSC 811 Autofill" via IticModal.
  // Advanced: Firebase fileTicketBot (hands-off auto-submit).
  const jobAddress = [job?.address, job?.city, job?.zipCode].filter(Boolean).join(", ");
  const workForLabel =
    (job?.customerProject ?? "").trim().toLowerCase() === "ziply" ? "ZIPLY" : "LUMEN";
  const workToBeginDate = addBusinessDays(new Date(), 2);
  const workToBeginMDY = formatMDY(workToBeginDate);

  const runCloudBot = async () => {
    if (
      !window.confirm(
        "Run the cloud bot? It logs into ITIC with server secrets and auto-submits end-to-end. Prefer the Autofill extension for day-to-day filing."
      )
    ) {
      return;
    }
    setBotBusy(true);
    setError(null);
    setNotice("Cloud bot filing… this can take several minutes.");
    try {
      await api.updateDigTicket(ticket.id, { status: "Filing" });
      const result = await api.fileTicketBot(ticket.id);
      const t = await refetch();
      onUpdated(t);
      if (result.ticketNumber) setFiledNumber(result.ticketNumber);
      setNotice(
        result.ticketNumber
          ? `Bot filed ITIC #${result.ticketNumber}.`
          : `Bot finished with status ${result.status}.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cloud bot failed");
      try {
        const t = await refetch();
        onUpdated(t);
      } catch {
        /* ignore */
      }
    } finally {
      setBotBusy(false);
    }
  };

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
          extensionConnected={extensionActive}
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
	            {ticket.scope && <> · Section: {ticket.scope.label || ticket.scope.terminalRange || ticket.scope.ref}</>}
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

      {/* Step Progress Stepper */}
      {["Drafting", "Review", "Filing", "Failed"].includes(ticket.status) && (
        <div className="dt-stepper">
          <div className={`dt-step-indicator ${["Drafting", "Review", "Filing"].includes(ticket.status) ? "active" : "completed"}`}>
            <div className="step-num">1</div>
            <div className="step-label">Launch & Center</div>
          </div>
          <div className={`dt-step-line ${["Review", "Filing"].includes(ticket.status) ? "completed" : ""}`}></div>
          <div className={`dt-step-indicator ${ticket.status === "Drafting" ? "" : ticket.status === "Review" ? "active" : "completed"}`}>
            <div className="step-num">2</div>
            <div className="step-label">Manual Drawing</div>
          </div>
          <div className={`dt-step-line ${ticket.status === "Filing" ? "completed" : ""}`}></div>
          <div className={`dt-step-indicator ${ticket.status === "Filing" ? "active" : ""}`}>
            <div className="step-num">3</div>
            <div className="step-label">Autofill Specs</div>
          </div>
          <div className={`dt-step-line`}></div>
          <div className={`dt-step-indicator`}>
            <div className="step-num">4</div>
            <div className="step-label">Submit & Scrape</div>
          </div>
        </div>
      )}

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
	          {ticket.scope && <div><span>Section</span><b>{ticket.scope.label || ticket.scope.ref}</b></div>}
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

      {/* Adaptive 811 filing: Autofill when extension present; cloud bot when not (work PCs). */}
      <section className="dt-copilot-card">
        <div className="dt-copilot-header">
          <span className="dt-copilot-title">File 811 dig ticket</span>
          <span className={`dt-extension-status ${extensionActive ? "" : "not-detected"}`}>
            {extensionActive
              ? "● NSC 811 Autofill connected"
              : "○ No extension — cloud bot is primary"}
          </span>
        </div>

        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#475569", lineHeight: 1.45 }}>
          {extensionActive ? (
            <>
              <strong>This computer has the Autofill extension.</strong> File with Autofill opens
              ITIC in your browser, fills fields, and you draw/confirm the dig shape before submit.
              Locate # can sync back here.
            </>
          ) : (
            <>
              <strong>No Autofill extension detected</strong> (common on work-managed Chrome).{" "}
              <strong>Cloud bot is the main path</strong> — no install needed. It uses server ITIC
              login and auto-submits. You can still open a guided ITIC tab or file manually from
              Other options.
            </>
          )}
        </p>

        <div className="dt-request811__summary">
          <div><span>Address</span><b>{jobAddress || "—"}</b></div>
          <div><span>Work type</span><b>{ticket.specs.workType || "—"}</b></div>
          <div><span>Work for</span><b>{workForLabel}</b></div>
          <div><span>Duration</span><b>{ticket.specs.duration || 45} days</b></div>
          <div><span>Work to begin</span><b>{workToBeginMDY}</b></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16, width: "100%" }}>
          {extensionActive ? (
            <>
              <button
                type="button"
                className="dt-btn dt-btn--primary"
                style={{ width: "100%", background: "#1d4ed8", fontWeight: 700, padding: "12px 16px" }}
                onClick={() => setIticOpen(true)}
                disabled={!!busy || botBusy}
              >
                File 811 with Autofill
              </button>
              <button
                type="button"
                className="dt-btn dt-btn--secondary"
                style={{ width: "100%", fontWeight: 700 }}
                onClick={() => void runCloudBot()}
                disabled={botBusy || !!busy}
              >
                {botBusy ? "Bot running…" : "Or file with cloud bot (auto-submit)"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="dt-btn dt-btn--primary"
                style={{ width: "100%", background: "#0f766e", fontWeight: 700, padding: "12px 16px" }}
                onClick={() => void runCloudBot()}
                disabled={botBusy || !!busy}
              >
                {botBusy ? "Cloud bot filing… (can take several minutes)" : "File 811 with cloud bot"}
              </button>
              <p style={{ margin: 0, fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>
                Best for work computers where Chrome blocks Load unpacked. Confirm ITIC secrets are
                set on Firebase. Auto-submits end-to-end.
              </p>
              <button
                type="button"
                className="dt-btn dt-btn--secondary"
                style={{ width: "100%", fontWeight: 700 }}
                onClick={() => setIticOpen(true)}
                disabled={!!busy || botBusy}
              >
                Open guided ITIC tab (no extension autofill)
              </button>
            </>
          )}

          <div className="dt-request811__filed" style={{ marginTop: 4 }}>
            <label className="dt-field">
              <span>Filed ticket #</span>
              <input
                value={filedNumber}
                onChange={(e) => setFiledNumber(e.target.value)}
                placeholder="Paste ITIC locate # if needed"
              />
            </label>
            <button
              type="button"
              className="dt-btn dt-btn--primary dt-btn--sm"
              onClick={saveFiledTicket}
              disabled={busy === "save-filed" || filedNumber.trim() === ""}
            >
              {busy === "save-filed" ? "Saving…" : "Save filed ticket"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              textAlign: "left",
              padding: 0,
            }}
          >
            {showAdvanced ? "▾ Hide other options" : "▸ Other options (manual + extension install)"}
          </button>

          {showAdvanced && (
            <div
              style={{
                border: "1px dashed #cbd5e1",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                background: "#f8fafc",
              }}
            >
              {!extensionActive && (
                <div className="dt-copilot-instructions" style={{ margin: 0 }}>
                  <strong>If your work PC allows it — install Autofill:</strong>
                  <ol className="dt-instruction-steps">
                    <li>Open <code>chrome://extensions/</code></li>
                    <li>Turn on <strong>Developer mode</strong> (if available)</li>
                    <li>
                      <strong>Load unpacked</strong> →{" "}
                      <code>chrome-extension</code> (NSC 811 Autofill)
                    </li>
                    <li>If Developer mode is locked by IT, stay on cloud bot — that is fine</li>
                  </ol>
                </div>
              )}
              {extensionActive && (
                <p style={{ margin: 0, fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>
                  Cloud bot is available as a secondary button above. Use it when you want
                  hands-off auto-submit without drawing on ITIC yourself.
                </p>
              )}

              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                Clipboard helpers (fully manual ITIC)
              </span>
              <div className="dt-copy-helper">
                <span>Street Address:</span>
                <code>{job?.address || "—"}</code>
                <button
                  type="button"
                  className={`dt-btn-copy ${copiedField === "address" ? "copied" : ""}`}
                  onClick={() => copyToClipboard(job?.address || "", "address")}
                >
                  {copiedField === "address" ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="dt-copy-helper">
                <span>Marking Instructions:</span>
                <code style={{ maxWidth: 250 }}>{marking || "—"}</code>
                <button
                  type="button"
                  className={`dt-btn-copy ${copiedField === "marking" ? "copied" : ""}`}
                  onClick={() => copyToClipboard(marking || "", "marking")}
                >
                  {copiedField === "marking" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>

        {notice && <div className="dt-request811__notice" style={{ marginTop: 12 }}>{notice}</div>}

        {/* PDF & Screenshot links */}
        {(ticket.iticPdfUrl || ticket.automation.reviewScreenshotUrl || ticket.automation.confirmationScreenshotUrl) && (
          <div style={{ marginTop: "16px", borderTop: "1px solid #f1f5f9", paddingTop: "12px", display: "flex", gap: "12px" }}>
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
          </div>
        )}

        {ticket.automation.botErrors.length > 0 && (
          <div className="dt-error" style={{ marginTop: "12px" }}>{ticket.automation.botErrors.at(-1)}</div>
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
