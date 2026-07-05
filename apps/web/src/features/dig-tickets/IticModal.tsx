// Full-screen ITIC filing modal: guides the user through filing in a new tab.
// This bypasses browser SameSite cookie restrictions that block third-party logins in iframes.
//
// On open we broadcast the job data over window.postMessage on the well-known
// NSC_811_JOB_DATA channel. The companion Chrome extension (chrome-extension/)
// listens for it, stashes the payload, and drives the ITIC autofill inside the new tab.
import { useEffect } from "react";
import type { DigTicket, Job } from "@nsc/types";

const ITIC_URL = "https://wa.itic.occinc.com/";
const TICKET_TYPE = "2 full business days ticket";

export interface Itic811JobData {
  address: string;
  workType: string;
  ticketType: string;
  excavator: string;
  workToBegin: string; // MM/DD/YYYY
  workToBeginMs: number;
  durationDays: number;
  markingInstructions: string;
  workOrder: string;
}

interface Props {
  ticket: DigTicket;
  job: Job | null;
  jobAddress: string;
  markingInstructions: string;
  workToBegin: string; // MM/DD/YYYY (today + 2 business days)
  workToBeginMs: number;
  filedNumber: string;
  onFiledNumberChange: (v: string) => void;
  onSaveFiled: () => void;
  saving: boolean;
  onClose: () => void;
}

export default function IticModal({
  ticket,
  job,
  jobAddress,
  markingInstructions,
  workToBegin,
  workToBeginMs,
  filedNumber,
  onFiledNumberChange,
  onSaveFiled,
  saving,
  onClose,
}: Props) {
  // Broadcast the job data for the extension exactly once, on open.
  useEffect(() => {
    const payload: Itic811JobData = {
      address: jobAddress,
      workType: ticket.specs.workType || "",
      ticketType: TICKET_TYPE,
      excavator: "LUMEN",
      workToBegin,
      workToBeginMs,
      durationDays: 45,
      markingInstructions: markingInstructions || "",
      workOrder: job?.workOrder ?? ticket.jobId,
    };
    window.postMessage({ type: "NSC_811_JOB_DATA", payload }, window.location.origin);
  }, [
    jobAddress,
    ticket.specs.workType,
    ticket.jobId,
    workToBegin,
    workToBeginMs,
    markingInstructions,
    job?.workOrder,
  ]);

  // Attempt to open the tab automatically on mount (pop-up blockers might block it)
  useEffect(() => {
    window.open(ITIC_URL, "_blank");
  }, []);

  // Listen for the Chrome extension bridging the successfully filed ticket number
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data;
      if (data && data.type === "NSC_811_FILED_SUCCESS" && data.payload?.ticketNumber) {
        const ticketNo = data.payload.ticketNumber;
        console.log("[IticModal] auto-save message captured:", ticketNo);
        onFiledNumberChange(ticketNo);
        
        // Auto-save the ticket number once React finishes state updates
        setTimeout(() => {
          const btn = document.querySelector(".itic-save-btn") as HTMLButtonElement;
          if (btn && !btn.disabled) {
            btn.click();
          }
        }, 300);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onFiledNumberChange]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="itic-modal__backdrop" role="dialog" aria-modal="true" aria-label="File 811 with ITIC">
      <div className="itic-modal">
        <header className="itic-modal__bar">
          <span className="itic-modal__title">FILE 811 · {job?.workOrder ?? ticket.jobId}</span>
          <button className="itic-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="itic-modal__body">
          <div className="itic-modal__instruction-pane">
            <div className="itic-instruction__card">
              <h2 className="itic-instruction__heading">Filing 811 Dig Ticket securely</h2>
              <p className="itic-instruction__intro">
                Due to modern browser security restrictions on third-party cookies, ITIC's login session cannot run reliably inside an iframe. We've opened ITIC in a new browser tab for you to file securely.
              </p>
              
              <div className="itic-steps">
                <div className="itic-step">
                  <div className="itic-step__num">1</div>
                  <div className="itic-step__text">
                    <strong>Launch ITIC Tab</strong>
                    <p>Log in with your standard credentials in the new browser tab.</p>
                    <button
                      onClick={() => window.open(ITIC_URL, "_blank")}
                      className="dt-btn dt-btn--primary itic-launch-btn"
                    >
                      🚀 Open ITIC in New Tab
                    </button>
                  </div>
                </div>

                <div className="itic-step">
                  <div className="itic-step__num">2</div>
                  <div className="itic-step__text">
                    <strong>Extension Autofill</strong>
                    <p>The companion Chrome extension will automatically pre-fill the job address, work order, and marking instructions in the tab.</p>
                  </div>
                </div>

                <div className="itic-step">
                  <div className="itic-step__num">3</div>
                  <div className="itic-step__text">
                    <strong>Draw & Submit</strong>
                    <p>Draw your excavation boundary shape on the map, confirm the details, and submit the ticket on the ITIC site.</p>
                  </div>
                </div>

                <div className="itic-step">
                  <div className="itic-step__num">4</div>
                  <div className="itic-step__text">
                    <strong>Automatic Sync</strong>
                    <p>Once you click submit, the extension will automatically capture the ticket number, close the tab, and save it back here.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <aside className="itic-modal__side">
            <section className="itic-side__card">
              <div className="itic-side__title">JOB</div>
              <div className="itic-side__row"><span>Address</span><b>{jobAddress || "—"}</b></div>
              <div className="itic-side__row"><span>Work order</span><b>{job?.workOrder ?? ticket.jobId}</b></div>
              <div className="itic-side__row"><span>Work for</span><b>LUMEN</b></div>
              <div className="itic-side__row"><span>Ticket type</span><b>{TICKET_TYPE}</b></div>
              <div className="itic-side__row"><span>Work to begin</span><b>{workToBegin}</b></div>
              <div className="itic-side__row"><span>Duration</span><b>45 days</b></div>
            </section>

            <section className="itic-side__card">
              <div className="itic-side__title">MARKING INSTRUCTIONS</div>
              <p className="itic-side__marking">{markingInstructions || "—"}</p>
            </section>

            <section className="itic-side__card">
              <div className="itic-side__title">SAVE TICKET HANDOFF</div>
              <label className="dt-field">
                <span>Filed ticket #</span>
                <input
                  value={filedNumber}
                  onChange={(e) => onFiledNumberChange(e.target.value)}
                  placeholder="Waiting for extension sync..."
                />
              </label>
              <button
                className="dt-btn dt-btn--primary dt-btn--sm itic-save-btn"
                onClick={onSaveFiled}
                disabled={saving || filedNumber.trim() === ""}
              >
                {saving ? "Saving…" : "Save filed ticket"}
              </button>
              <p className="itic-side__hint">
                You can manually paste the ticket number here if you don't have the extension active.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
