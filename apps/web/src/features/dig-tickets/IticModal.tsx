// Full-screen ITIC filing modal: embeds wa.itic.occinc.com in an iframe (ITIC
// sends no X-Frame-Options / CSP frame-ancestors, so it frames cleanly) with a
// right sidebar carrying the job context + the "filed ticket #" write-back.
//
// On open we broadcast the job data over window.postMessage on the well-known
// NSC_811_JOB_DATA channel. The companion Chrome extension (chrome-extension/)
// listens for it, stashes the payload, and drives the ITIC autofill inside the
// iframe. The app itself never touches the ITIC DOM.
import { useEffect } from "react";
import type { DigTicket, Job } from "@nsc/types";

const ITIC_URL = "https://wa.itic.occinc.com/";
// ITIC's normal non-emergency ticket. Kept in lockstep with the server bot's
// DEFAULT_TICKET_TYPE (functions/src/itic.ts) so the extension selects the same
// dashboard option.
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
  // Broadcast the job data for the extension exactly once, on open. The message
  // is posted to our own window; the extension's content script on this origin
  // listens for it and hands it to the ITIC-side content script via storage.
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
          <iframe
            className="itic-modal__frame"
            src={ITIC_URL}
            title="ITIC — WA Utilities Underground Location Center"
          />
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
              <div className="itic-side__title">SAVE FILED TICKET</div>
              <label className="dt-field">
                <span>Filed ticket #</span>
                <input
                  value={filedNumber}
                  onChange={(e) => onFiledNumberChange(e.target.value)}
                  placeholder="Paste the ITIC ticket # after you submit"
                />
              </label>
              <button
                className="dt-btn dt-btn--primary dt-btn--sm"
                onClick={onSaveFiled}
                disabled={saving || filedNumber.trim() === ""}
              >
                {saving ? "Saving…" : "Save filed ticket"}
              </button>
              <p className="itic-side__hint">
                Draw your shape in ITIC, hit Next, then submit. Paste the assigned
                ticket # here to mark it Filed.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
