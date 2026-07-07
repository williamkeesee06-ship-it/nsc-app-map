// Detail view for one dig ticket: shape stats, editable marking instructions
// (Gemini-generated, regenerable), hazards + safe guidelines, the utility
// response panel, status transitions, and the renewal flow.
import { useEffect, useState } from "react";
import type { DigTicket, DigTicketStatus, Job, UtilityStatus } from "@nsc/types";
import { canDeleteDigTicket } from "@nsc/types";
import { api } from "../../lib/api.js";
import { statusColor, utilityStatusColor, UTILITY_STATUS_OPTIONS } from "./ticketStyle.js";
import IticModal from "./IticModal.js";
import { getBookmarkletCode } from "./bookmarkletCode.js";

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
  const [filingMethod, setFilingMethod] = useState<"extension" | "bookmarklet">("extension");

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  useEffect(() => {
    const ping = setInterval(() => {
      window.postMessage({ type: "NSC_PING_EXTENSION" }, "*");
    }, 1000);
    const listener = (e: MessageEvent) => {
      if (e.data?.type === "NSC_PONG_EXTENSION") {
        setExtensionActive(true);
        clearInterval(ping);
      }
    };
    window.addEventListener("message", listener);
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

  const runExtensionFiler = () => {
    const payload = {
      ticketId: ticket.id,
      address: jobAddress,
      street: job?.address || "",
      city: job?.city || "",
      zip: job?.zipCode || "",
      workType: ticket.specs.workType || "PED SWAP",
      workDoneFor: "LUMEN",
      directionalBoring: ticket.specs.directionalBoring || false,
      markingInstructions: marking,
      equipment: ticket.specs.equipment || [],
      workToBeginDate: workToBeginMDY,
      duration: ticket.specs.duration || 45,
      whiteLined: ticket.specs.whiteLined || false,
      explosives: ticket.specs.explosives || false,
    };
    
    window.postMessage({ type: "NSC_START_ITIC_AUTOMATION", payload }, "*");
    setNotice("Chrome Extension triggered! A new tab will open to ITIC. Follow the on-screen instructions!");
  };

  const refetch = async () => (await api.getDigTicket(ticket.id)).ticket;

  useEffect(() => {
    const handleExtensionMessage = async (e: MessageEvent) => {
      if (e.data?.type === "NSC_ITIC_FILING_COMPLETED" && e.data?.ticketNumber) {
        setFiledNumber(e.data.ticketNumber);
        setNotice(`Scraped ITIC #${e.data.ticketNumber} from Chrome Extension! Saving...`);
        const num = e.data.ticketNumber;
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
          setNotice(`Filed ITIC #${num} successfully!`);
          onUpdated(t);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to save ticket number");
        }
      }
    };
    window.addEventListener("message", handleExtensionMessage);
    return () => window.removeEventListener("message", handleExtensionMessage);
  }, [ticket, refetch, onUpdated]);

  // ── Request 811 ──────────────────────────────────────────────────────────
  // The primary option is the fully-automated background bot. The manual option
  // uses the guided browser tab launcher.
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

      {/* Step Progress Stepper */}
      {["Drafting", "Review", "Filing", "Failed"].includes(ticket.status) && (
        <div className="dt-stepper dt-card-bg-1">
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
      <section className="dt-card dt-card-bg-2">
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
      <section className="dt-card dt-card-bg-3">
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
      {/* Redesigned Copilot filing section */}
      <section className="dt-copilot-card dt-card-bg-4">
        <div className="dt-copilot-header">
          <span className="dt-copilot-title">NSC Copilot Filing Center</span>
          {filingMethod === "extension" && (
            <span className={`dt-extension-status ${extensionActive ? "" : "not-detected"}`}>
              {extensionActive ? "● Copilot Connected" : "○ Copilot Not Active"}
            </span>
          )}
        </div>

        {/* Tab selection */}
        <div style={{ display: "flex", gap: "12px", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px", marginBottom: "16px" }}>
          <button
            style={{ background: "none", border: "none", borderBottom: filingMethod === "extension" ? "2px solid #2563eb" : "none", color: filingMethod === "extension" ? "#1e3a8a" : "#64748b", fontWeight: 700, cursor: "pointer", paddingBottom: "4px", fontSize: "13px" }}
            onClick={() => setFilingMethod("extension")}
          >
            Chrome Extension
          </button>
          <button
            style={{ background: "none", border: "none", borderBottom: filingMethod === "bookmarklet" ? "2px solid #2563eb" : "none", color: filingMethod === "bookmarklet" ? "#1e3a8a" : "#64748b", fontWeight: 700, cursor: "pointer", paddingBottom: "4px", fontSize: "13px" }}
            onClick={() => setFilingMethod("bookmarklet")}
          >
            Magic Bookmarklet (IT Fallback)
          </button>
        </div>

        <div className="dt-request811__summary">
          <div><span>Address</span><b>{jobAddress || "—"}</b></div>
          <div><span>Work type</span><b>{ticket.specs.workType || "—"}</b></div>
          <div><span>Work for</span><b>LUMEN</b></div>
          <div><span>Duration</span><b>45 days</b></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px", width: "100%" }}>
          {filingMethod === "extension" ? (
            <>
              <div style={{ display: "flex", gap: "8px", width: "100%" }}>
                <button
                  className="dt-btn dt-btn--primary"
                  style={{ flex: "1 1 50%", background: "#1d4ed8", fontWeight: 700 }}
                  onClick={runExtensionFiler}
                  disabled={!!busy}
                >
                  Launch NSC Copilot
                </button>
                <button
                  className="dt-btn dt-btn--secondary"
                  style={{ flex: "1 1 50%", border: "1px solid #cbd5e1", background: "#ffffff", color: "#1e293b", fontWeight: 700 }}
                  onClick={() => setIticOpen(true)}
                  disabled={!!busy}
                >
                  File Manually (Guided Tab)
                </button>
              </div>

              <div className="dt-copilot-instructions">
                <strong>Chrome Extension Setup Instructions:</strong>
                <ol className="dt-instruction-steps">
                  <li>Open Chrome and navigate to: <code>chrome://extensions/</code></li>
                  <li>In the top-right corner, toggle <strong>Developer mode</strong> to <strong>ON</strong>.</li>
                  <li>Click <strong>Load unpacked</strong> in the top-left, and select the <code>apps/extension</code> folder in this project directory.</li>
                </ol>
                <div style={{ marginTop: "10px", fontSize: "12px", color: "#64748b" }}>
                  *Once installed, click "Launch NSC Copilot" to trigger the automatic page-filling. Follow the green notifications at the top of the ITIC portal pages.
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
                <a
                  href={getBookmarkletCode(window.location.origin)}
                  className="dt-btn dt-btn--primary"
                  style={{ display: "block", textAlign: "center", textDecoration: "none", background: "#16a34a", borderColor: "#16a34a", padding: "10px", borderRadius: "8px", color: "white", fontWeight: 700 }}
                  onClick={(e) => {
                    alert("Drag this green button directly to your Chrome Bookmarks Bar, then click 'Open ITIC in New Tab'!");
                    e.preventDefault();
                  }}
                >
                  Drag to Bookmarks: NSC Copilot
                </a>
                <button
                  className="dt-btn dt-btn--secondary"
                  style={{ width: "100%", fontWeight: 700 }}
                  onClick={() => window.open(`https://wa.itic.occinc.com/#nscTicketId=${ticket.id}`, "_blank")}
                >
                  Open ITIC in New Tab
                </button>
              </div>

              <div className="dt-copilot-instructions">
                <strong>Bookmarklet Setup & Instructions:</strong>
                <ol className="dt-instruction-steps">
                  <li><strong>Drag the green button above</strong> directly onto your Chrome bookmarks bar.</li>
                  <li>Click <strong>"Open ITIC in New Tab"</strong> to launch the portal with the ticket context.</li>
                  <li>At any form page on ITIC (Step 1, Step 2, etc.), **simply click the "NSC Copilot" bookmark** in your bookmarks bar. It will instantly autofill the fields!</li>
                  <li>Once you submit, click the bookmark on the confirmation page to automatically sync the Ticket Number back to this app!</li>
                </ol>
              </div>
            </>
          )}

          {/* Manual Backup copy helper list */}
          <div style={{ marginTop: "12px", borderTop: "1px dashed #e2e8f0", paddingTop: "12px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#64748b", display: "block", marginBottom: "8px" }}>
              Manual Filing Clipboard Helpers
            </span>
            <div className="dt-copy-helper">
              <span>Street Address:</span>
              <code>{job?.address || "—"}</code>
              <button 
                className={`dt-btn-copy ${copiedField === "address" ? "copied" : ""}`}
                onClick={() => copyToClipboard(job?.address || "", "address")}
              >
                {copiedField === "address" ? "Copied!" : "Copy"}
              </button>
            </div>
            <div className="dt-copy-helper">
              <span>Marking Instructions:</span>
              <code style={{ maxWidth: "250px" }}>{marking || "—"}</code>
              <button 
                className={`dt-btn-copy ${copiedField === "marking" ? "copied" : ""}`}
                onClick={() => copyToClipboard(marking || "", "marking")}
              >
                {copiedField === "marking" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>

        <div className="dt-request811__filed" style={{ marginTop: "18px" }}>
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
        {notice && <div className="dt-request811__notice" style={{ marginTop: "12px" }}>{notice}</div>}

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
        <section className="dt-card dt-card--hazard dt-card-bg-5">
          <div className="dt-card__title">⚠ HAZARDS</div>
          <p>{ticket.hazardsWarning}</p>
        </section>
      )}

      {guidelines.length > 0 && (
        <section className="dt-card dt-card-bg-6">
          <div className="dt-card__title">SAFE EXCAVATION GUIDELINES</div>
          <ul className="dt-guidelines">
            {guidelines.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </section>
      )}

      {/* Utility response panel */}
      <section className="dt-card dt-card-bg-1">
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
      <section className="dt-card dt-card-bg-2">
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
