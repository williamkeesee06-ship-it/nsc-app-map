// 811 Dig Ticket Manager — full-screen tab mounted over the map by JobsMap.
//
// Layout: a left ActiveList of tickets grouped by status + a right pane that shows either the
// TicketDetail (with the UtilityResponsePanel and RenewalFlow) or a "create
// from job" form. Tickets are backed by /api/dig-tickets; the dig shape is
// snapshotted server-side from the job's saved digPolygon at creation time.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DigTicket, Job, ZiplySectionScope } from "@nsc/types";
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
  const { username, isManager } = useAuth();
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
  const [initialScope, setInitialScope] = useState<ZiplySectionScope | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const owner = isManager ? "*" : username || "";
      const { tickets: t } = await api.listDigTickets(owner);
      setTickets(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [username, isManager]);

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
    const applyDetail = (detail: { jobId?: string; scope?: ZiplySectionScope | null } | null) => {
      const jobId = detail?.jobId;
      if (!jobId) return;
      const job = jobs.find((j) => j.jobId === jobId);
      const activeTicketId = job?.activeTicketId;
      const scope = detail.scope ?? null;
      const activeTicket = scope
        ? tickets.find((t) => t.jobId === jobId && t.scope?.kind === scope.kind && t.scope?.ref === scope.ref)
        : activeTicketId
          ? tickets.find((t) => t.id === activeTicketId)
          : null;
      if (activeTicket) {
        setCreating(false);
        setInitialJobId(null);
        setInitialScope(null);
        setSelectedId(activeTicket.id);
      } else {
        setSelectedId(null);
        setInitialJobId(jobId);
        setInitialScope(scope);
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
    () => initialScope && initialJobId ? jobs.filter((j) => j.jobId === initialJobId) : jobs.filter((j) => j.digPolygon),
    [jobs, initialJobId, initialScope]
  );

  // Group tickets by urgency category
  const urgentTickets = useMemo(
    () => tickets.filter((t) => ["Expired", "Expiring", "Failed"].includes(t.status)),
    [tickets]
  );

  const activeTickets = useMemo(
    () => tickets.filter((t) => ["Active", "Filed"].includes(t.status)),
    [tickets]
  );

  const draftTickets = useMemo(
    () => tickets.filter((t) => ["Drafting", "Review", "Filing"].includes(t.status)),
    [tickets]
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

  const renderTicketItem = (t: DigTicket) => {
    const job = jobById(t.jobId);
    const hasAlert = ["Expired", "Failed"].includes(t.status);
    const isExpiring = t.status === "Expiring";
    
    let trimColor = "#3b82f6"; // Royal Blue default
    if (hasAlert) trimColor = "#dc2626"; // Warning Red
    else if (isExpiring) trimColor = "#d97706"; // Amber
    else if (t.status === "Active" || t.status === "Filed") trimColor = "#16a34a"; // Success Green

    return (
      <li key={t.id} className="dt-ticket-item">
        <button
          className={`dt-ticket${selectedId === t.id ? " dt-ticket--active" : ""}`}
          style={{ borderLeft: `4px solid ${trimColor}` }}
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
	            {t.ticketNumber || "— draft —"} ·{" "}
	            {t.scope?.label || t.scope?.terminalRange || t.shape.type} · {Math.round(t.shape.areaSqFt).toLocaleString()} ft²
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
  };

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
            + Request 811
          </button>
        </div>

        {/* Live Dispatches Stats Card */}
        <div className="dt-list__stats">
          <div className="dt-stat-pill dt-stat-pill--danger">
            <span className="dt-stat-val">{urgentTickets.length}</span>
            <span className="dt-stat-lbl">Alerts</span>
          </div>
          <div className="dt-stat-pill dt-stat-pill--success">
            <span className="dt-stat-val">{activeTickets.length}</span>
            <span className="dt-stat-lbl">Active</span>
          </div>
          <div className="dt-stat-pill dt-stat-pill--draft">
            <span className="dt-stat-val">{draftTickets.length}</span>
            <span className="dt-stat-lbl">Drafts</span>
          </div>
        </div>

        {loading && <div className="dt-list__empty">Loading tickets…</div>}
        {error && <div className="dt-error">{error}</div>}
        {!loading && tickets.length === 0 && (
          <div className="dt-list__empty">
            No dig tickets yet. Draw a dig shape on a job, then create one.
          </div>
        )}

        <div className="dt-list__groups">
          {/* Group 1: Action Required */}
          {urgentTickets.length > 0 && (
            <div className="dt-list-group">
              <div className="dt-list-group__title dt-list-group__title--urgent">ACTION REQUIRED</div>
              <ul className="dt-list__items">
                {urgentTickets.map(renderTicketItem)}
              </ul>
            </div>
          )}

          {/* Group 2: Active */}
          {activeTickets.length > 0 && (
            <div className="dt-list-group">
              <div className="dt-list-group__title dt-list-group__title--active">ACTIVE TICKETS</div>
              <ul className="dt-list__items">
                {activeTickets.map(renderTicketItem)}
              </ul>
            </div>
          )}

          {/* Group 3: Drafts */}
          {draftTickets.length > 0 && (
            <div className="dt-list-group">
              <div className="dt-list-group__title dt-list-group__title--draft">DRAFTS & IN-PROGRESS</div>
              <ul className="dt-list__items">
                {draftTickets.map(renderTicketItem)}
              </ul>
            </div>
          )}
        </div>
      </aside>

      <main className="dt-detail">
        {creating ? (
          <CreateTicketForm
            jobs={ticketableJobs}
	            username={username}
	            initialJobId={initialJobId}
	            initialScope={initialScope}
	            onCreated={(t) => {
	              setInitialJobId(null);
	              setInitialScope(null);
	              onTicketCreated(t);
	            }}
	            onCancel={() => {
	              setInitialJobId(null);
	              setInitialScope(null);
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
