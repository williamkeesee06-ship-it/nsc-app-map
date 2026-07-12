// Official 811 filing modal (Roadmap C).
// Opens ITIC in a new tab and broadcasts job data on NSC_811_JOB_DATA for the
// chrome-extension/ "NSC 811 Autofill" companion. You draw the dig shape on ITIC.
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
  ticketId?: string;
}

interface Props {
  ticket: DigTicket;
  job: Job | null;
  jobAddress: string;
  markingInstructions: string;
  workToBegin: string;
  workToBeginMs: number;
  filedNumber: string;
  onFiledNumberChange: (v: string) => void;
  onSaveFiled: () => void;
  saving: boolean;
  onClose: () => void;
  extensionConnected?: boolean;
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
  extensionConnected = false,
}: Props) {
  const excavator =
    (job?.customerProject ?? "").trim().toLowerCase() === "ziply" ? "ZIPLY" : "LUMEN";

  // Broadcast job data for the official extension on open (and re-broadcast
  // if marking/address changes while modal is open).
  useEffect(() => {
    const payload: Itic811JobData = {
      address: jobAddress,
      workType: ticket.specs.workType || "",
      ticketType: TICKET_TYPE,
      excavator,
      workToBegin,
      workToBeginMs,
      durationDays: ticket.specs.duration || 45,
      markingInstructions: markingInstructions || "",
      workOrder: job?.workOrder ?? ticket.jobId,
      ticketId: ticket.id,
    };
    window.postMessage({ type: "NSC_811_JOB_DATA", payload }, window.location.origin);
  }, [
    jobAddress,
    ticket.specs.workType,
    ticket.specs.duration,
    ticket.jobId,
    ticket.id,
    workToBegin,
    workToBeginMs,
    markingInstructions,
    job?.workOrder,
    excavator,
  ]);

  useEffect(() => {
    window.open(ITIC_URL, "_blank");
  }, []);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data;
      if (data && data.type === "NSC_811_FILED_SUCCESS" && data.payload?.ticketNumber) {
        const ticketNo = String(data.payload.ticketNumber);
        onFiledNumberChange(ticketNo);
        setTimeout(() => {
          const btn = document.querySelector(".itic-save-btn") as HTMLButtonElement | null;
          if (btn && !btn.disabled) btn.click();
        }, 300);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onFiledNumberChange]);

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
              <h2 className="itic-instruction__heading">Official path: NSC 811 Autofill</h2>
              <p className="itic-instruction__intro">
                ITIC opens in a new tab using <strong>your</strong> browser login. The Chrome
                extension pre-fills fields from this app. <strong>You draw the dig shape</strong>{" "}
                on ITIC, then submit. Paste or auto-sync the locate number back here.
              </p>
              <p
                style={{
                  margin: "0 0 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: extensionConnected ? "#15803d" : "#b45309",
                }}
              >
                {extensionConnected
                  ? "● NSC 811 Autofill extension detected"
                  : "○ Extension not detected — install chrome-extension/ (Load unpacked)"}
              </p>

              <div className="itic-steps">
                <div className="itic-step">
                  <div className="itic-step__num">1</div>
                  <div className="itic-step__text">
                    <strong>ITIC tab</strong>
                    <p>Log in if needed. Job data was sent to the extension for autofill.</p>
                    <button
                      type="button"
                      onClick={() => {
                        window.postMessage(
                          {
                            type: "NSC_811_JOB_DATA",
                            payload: {
                              address: jobAddress,
                              workType: ticket.specs.workType || "",
                              ticketType: TICKET_TYPE,
                              excavator,
                              workToBegin,
                              workToBeginMs,
                              durationDays: ticket.specs.duration || 45,
                              markingInstructions: markingInstructions || "",
                              workOrder: job?.workOrder ?? ticket.jobId,
                              ticketId: ticket.id,
                            } satisfies Itic811JobData,
                          },
                          window.location.origin
                        );
                        window.open(ITIC_URL, "_blank");
                      }}
                      className="dt-btn dt-btn--primary itic-launch-btn"
                    >
                      Open / re-open ITIC
                    </button>
                  </div>
                </div>

                <div className="itic-step">
                  <div className="itic-step__num">2</div>
                  <div className="itic-step__text">
                    <strong>Autofill</strong>
                    <p>
                      Extension fills address, work type, dates, and marking text. Confirm fields
                      look right.
                    </p>
                  </div>
                </div>

                <div className="itic-step">
                  <div className="itic-step__num">3</div>
                  <div className="itic-step__text">
                    <strong>Draw dig shape &amp; submit</strong>
                    <p>
                      On the ITIC map step, draw the excavation boundary (same shape you planned in
                      the app), then submit the ticket.
                    </p>
                  </div>
                </div>

                <div className="itic-step">
                  <div className="itic-step__num">4</div>
                  <div className="itic-step__text">
                    <strong>Save locate #</strong>
                    <p>
                      Extension may fill the ticket # automatically. Otherwise paste it and click
                      Save filed ticket.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside className="itic-modal__side">
            <section className="itic-side__card">
              <div className="itic-side__title">JOB</div>
              <div className="itic-side__row">
                <span>Address</span>
                <b>{jobAddress || "—"}</b>
              </div>
              <div className="itic-side__row">
                <span>Work order</span>
                <b>{job?.workOrder ?? ticket.jobId}</b>
              </div>
              <div className="itic-side__row">
                <span>Work for</span>
                <b>{excavator}</b>
              </div>
              <div className="itic-side__row">
                <span>Ticket type</span>
                <b>{TICKET_TYPE}</b>
              </div>
              <div className="itic-side__row">
                <span>Work to begin</span>
                <b>{workToBegin}</b>
              </div>
              <div className="itic-side__row">
                <span>Duration</span>
                <b>{ticket.specs.duration || 45} days</b>
              </div>
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
                  placeholder="Paste locate # from ITIC"
                />
              </label>
              <button
                type="button"
                className="dt-btn dt-btn--primary dt-btn--sm itic-save-btn"
                onClick={onSaveFiled}
                disabled={saving || filedNumber.trim() === ""}
              >
                {saving ? "Saving…" : "Save filed ticket"}
              </button>
              <p className="itic-side__hint">
                Saving marks this ticket Filed and starts Smartsheet write-back when configured.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
