// 811 Dig Ticket Manager — full-screen tab mounted over the map by JobsMap.
//
// Layout: a left ActiveList of tickets + a right pane that shows either the
// TicketDetail (with the UtilityResponsePanel and RenewalFlow) or a "create
// from job" form. Tickets are backed by /api/dig-tickets; the dig shape is
// snapshotted server-side from the job's saved digPolygon at creation time.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DigTicket, Job } from "@nsc/types";
import { canDeleteDigTicket } from "@nsc/types";
import { api } from "../../lib/api.js";
import { useAuth } from "../auth/authContext.js";
import TicketDetail from "./TicketDetail.js";
import CreateTicketForm from "./CreateTicketForm.js";
import { statusColor } from "./ticketStyle.js";
import "./digTickets.css";

interface Props {
  jobs: Job[];
  onOpenJob: (job: Job) => void;
}

export default function DigTicketsTab({ jobs, onOpenJob }: Props) {
  const { username } = useAuth();
  const [tickets, setTickets] = useState<DigTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Auto-open flag driven by Lumina's startDigTicket tool.
  const [autoOpenModal, setAutoOpenModal] = useState(false);
  // Job to pre-select in CreateTicketForm, set when the map's "Save & Open
  // 811" flow targets a job with no active ticket.
  const [initialJobId, setInitialJobId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { tickets: t } = await api.listDigTickets();
      setTickets(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Lumina hook: startDigTicket dispatches nsc:lumina:openDigTicket with
  // { ticketId, openIticModal }. Also honor a sessionStorage flag set at
  // the same time so the request survives an intervening tab switch.
  useEffect(() => {
    const applyDetail = (detail: { ticketId?: string; openIticModal?: boolean } | null) => {
      if (!detail?.ticketId) return;
      setCreating(false);
      setSelectedId(detail.ticketId);
      if (detail.openIticModal) setAutoOpenModal(true);
    };
    try {
      const raw = sessionStorage.getItem("nsc.lumina.openDigTicket");
      if (raw) {
        applyDetail(JSON.parse(raw));
        sessionStorage.removeItem("nsc.lumina.openDigTicket");
      }
    } catch {
      /* ignore malformed / disabled storage */
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      applyDetail(detail);
    };
    window.addEventListener("nsc:lumina:openDigTicket", handler);
    return () => window.removeEventListener("nsc:lumina:openDigTicket", handler);
  }, []);

  // Map hook: "Save & Open 811" dispatches nsc:map:openDigTicketForJob with
  // { jobId }. If that job already has an active ticket we select it; otherwise
  // we open CreateTicketForm pre-selected to the job. A sessionStorage flag
  // mirrors the event so the request survives the 811 tab mounting late.
  useEffect(() => {
    const applyDetail = (detail: { jobId?: string } | null) => {
      const jobId = detail?.jobId;
      if (!jobId) return;
      const job = jobs.find((j) => j.jobId === jobId);
      const activeTicketId = job?.activeTicketId;
      const activeTicket = activeTicketId
        ? tickets.find((t) => t.id === activeTicketId)
        : null;
      if (activeTicket) {
        setCreating(false);
        setInitialJobId(null);
        setSelectedId(activeTicket.id);
      } else {
        setSelectedId(null);
        setInitialJobId(jobId);
        setCreating(true);
      }
    };
    try {
      const raw = sessionStorage.getItem("nsc.map.openDigTicketForJob");
      if (raw) {
        applyDetail(JSON.parse(raw));
        sessionStorage.removeItem("nsc.map.openDigTicketForJob");
      }
    } catch {
      /* ignore malformed / disabled storage */
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      applyDetail(detail);
    };
    window.addEventListener("nsc:map:openDigTicketForJob", handler);
    return () => window.removeEventListener("nsc:map:openDigTicketForJob", handler);
  }, [jobs, tickets]);

  const selected = useMemo(
    () => tickets.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId]
  );

  // Jobs that have a dig shape drawn but no active ticket yet — candidates for
  // "create ticket".
  const ticketableJobs = useMemo(
    () => jobs.filter((j) => j.digPolygon),
    [jobs]
  );

  const onTicketUpdated = useCallback((updated: DigTicket) => {
    setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }, []);

  const onTicketCreated = useCallback((created: DigTicket) => {
    setTickets((prev) => [created, ...prev]);
    setSelectedId(created.id);
    setCreating(false);
  }, []);

  const jobById = useCallback(
    (jobId: string) => jobs.find((j) => j.jobId === jobId) ?? null,
    [jobs]
  );

  // Delete a draft/failed ticket after confirmation. Optimistically drop it
  // from the list, and refetch the authoritative list if the server rejects.
  const onTicketDeleted = useCallback((deletedId: string) => {
    setTickets((prev) => prev.filter((t) => t.id !== deletedId));
    setSelectedId((cur) => (cur === deletedId ? null : cur));
  }, []);

  const deleteTicket = useCallback(
    async (ticket: DigTicket) => {
      const label = jobById(ticket.jobId)?.workOrder || ticket.ticketNumber || ticket.jobId;
      if (!window.confirm(`Delete ticket ${label}? This cannot be undone.`)) return;
      const prev = tickets;
      onTicketDeleted(ticket.id);
      try {
        await api.deleteDigTicket(ticket.id);
      } catch (e) {
        setTickets(prev);
        setError(e instanceof Error ? e.message : "Failed to delete ticket");
        void refresh();
      }
    },
    [tickets, jobById, onTicketDeleted, refresh]
  );

  return (
    <div className="dt-root">
      <aside className="dt-list">
        <div className="dt-list__head">
          <span className="dt-list__title">811 DIG TICKETS</span>
          <button
            className="dt-btn dt-btn--primary dt-btn--sm"
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
            }}
          >
            Request 811
          </button>
        </div>

        {loading && <div className="dt-list__empty">Loading tickets…</div>}
        {error && <div className="dt-error">{error}</div>}
        {!loading && tickets.length === 0 && (
          <div className="dt-list__empty">
            No dig tickets yet. Draw a dig shape on a job, then create one.
          </div>
        )}

        <ul className="dt-list__items">
          {tickets.map((t) => {
            const job = jobById(t.jobId);
            return (
              <li key={t.id} className="dt-ticket-item">
                <button
                  className={`dt-ticket${selectedId === t.id ? " dt-ticket--active" : ""}`}
                  onClick={() => {
                    setSelectedId(t.id);
                    setCreating(false);
                  }}
                >
                  <span className="dt-ticket__wo">
                    {job?.workOrder ?? t.jobId}
                  </span>
                  <span
                    className="dt-ticket__status"
                    style={{ background: statusColor(t.status) }}
                  >
                    {t.status}
                  </span>
                  <span className="dt-ticket__meta">
                    {t.ticketNumber || "— not filed —"} ·{" "}
                    {t.shape.type} · {Math.round(t.shape.areaSqFt).toLocaleString()} ft²
                  </span>
                </button>
                {canDeleteDigTicket(t) && (
                  <button
                    className="dt-ticket__del"
                    title="Delete ticket"
                    aria-label="Delete ticket"
                    onClick={() => void deleteTicket(t)}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </aside>

      <main className="dt-detail">
        {creating ? (
          <CreateTicketForm
            jobs={ticketableJobs}
            username={username}
            initialJobId={initialJobId}
            onCreated={(t) => {
              setInitialJobId(null);
              onTicketCreated(t);
            }}
            onCancel={() => {
              setInitialJobId(null);
              setCreating(false);
            }}
          />
        ) : selected ? (
          <TicketDetail
            ticket={selected}
            job={jobById(selected.jobId)}
            onUpdated={onTicketUpdated}
            onDeleted={onTicketDeleted}
            onOpenJob={onOpenJob}
            autoOpenIticModal={autoOpenModal}
            onIticModalAcknowledged={() => setAutoOpenModal(false)}
          />
        ) : (
          <div className="dt-placeholder">
            <p>Select a ticket, or create a new one from a job with a dig shape.</p>
            {ticketableJobs.length > 0 && (
              <p className="dt-placeholder__hint">
                {ticketableJobs.length} job{ticketableJobs.length === 1 ? "" : "s"} ready to file.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
