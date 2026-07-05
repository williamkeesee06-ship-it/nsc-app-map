// Active Dig Tickets — filed/active 811 tickets sorted by soonest expiry.
// Reads the same /api/dig-tickets list the 811 tab uses; each row shows the
// parent job's work order, the ITIC ticket number, the expiration date, and a
// pill colored by days-until-expiry. Clicking a row jumps to the 811 tab.

import { useEffect, useMemo, useState } from "react";
import type { DigTicket, Job } from "@nsc/types";
import { api } from "../../../lib/api.js";
import Bezel from "../components/Bezel.js";

export interface ActiveDigTicketsCardProps {
  jobs: Job[];
}

// Only tickets that have been submitted to ITIC (they carry a ticket number and
// an expiry). Drafting/Failed have no number; Expired is kept so a lapsed
// ticket still surfaces with a red pill.
const VISIBLE_STATUSES = new Set<DigTicket["status"]>([
  "Filed",
  "Active",
  "Expiring",
  "Expired",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

function formatExpiry(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysUntil(ms: number, now: number): number {
  return Math.floor((ms - now) / DAY_MS);
}

interface Pill {
  label: string;
  className: string;
}

function pillFor(days: number): Pill {
  if (days < 0) return { label: "EXPIRED", className: "digtix-card__pill--red" };
  if (days <= 2) return { label: "EXPIRES SOON", className: "digtix-card__pill--red" };
  if (days <= 14) return { label: "EXPIRING SOON", className: "digtix-card__pill--yellow" };
  return { label: "ACTIVE", className: "digtix-card__pill--green" };
}

function openTicketsTab(): void {
  // TODO: pass the ticket id so the 811 tab pre-selects it. The tab doesn't yet
  // accept a target ticket, so for now we just switch tabs and let the user
  // click through from the 811 list.
  window.dispatchEvent(
    new CustomEvent("nsc:request-tab", { detail: { tab: "811-tickets" } })
  );
}

interface Row {
  ticket: DigTicket;
  jobNumber: string;
  expiresAt: number;
  pill: Pill;
}

export default function ActiveDigTicketsCard({ jobs }: ActiveDigTicketsCardProps) {
  const [tickets, setTickets] = useState<DigTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listDigTickets()
      .then(({ tickets: t }) => {
        if (!cancelled) setTickets(t);
      })
      .catch(() => {
        if (!cancelled) setTickets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo<Row[]>(() => {
    const now = Date.now();
    const jobNumberFor = (jobId: string) =>
      jobs.find((j) => j.jobId === jobId)?.workOrder ?? jobId;
    return tickets
      .filter(
        (t) =>
          VISIBLE_STATUSES.has(t.status) &&
          t.ticketNumber.trim() !== "" &&
          t.dates.expiresAt != null
      )
      .map((t) => {
        const expiresAt = t.dates.expiresAt as number;
        return {
          ticket: t,
          jobNumber: jobNumberFor(t.jobId),
          expiresAt,
          pill: pillFor(daysUntil(expiresAt, now)),
        };
      })
      .sort((a, b) => a.expiresAt - b.expiresAt);
  }, [tickets, jobs]);

  return (
    <Bezel className="card digtix-card" accent="#2fe6a8">
      <div className="card__header">
        <h2 className="card__title">Active Dig Tickets</h2>
        {rows.length > 0 && <span className="digtix-card__count">{rows.length}</span>}
      </div>

      {loading ? (
        <div className="dash-skel dash-skel--list" aria-hidden />
      ) : rows.length === 0 ? (
        <p className="digtix-card__empty">
          No active dig tickets. File one from the 811 tab.
        </p>
      ) : (
        <div className="digtix-card__scroll">
          <div className="digtix-card__list">
            {rows.map((r) => (
              <div
                key={r.ticket.id}
                className="digtix-card__item"
                tabIndex={0}
                role="button"
                aria-label={`Open dig ticket ${r.ticket.ticketNumber} on the 811 tab`}
                onClick={openTicketsTab}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openTicketsTab();
                  }
                }}
              >
                <div className="digtix-card__col digtix-card__col--job">
                  <span className="digtix-card__item-header">Job #</span>
                  <span className="digtix-card__item-text">{r.jobNumber}</span>
                </div>
                <div className="digtix-card__col digtix-card__col--ticket">
                  <span className="digtix-card__item-header">Ticket #</span>
                  <span className="digtix-card__item-text">{r.ticket.ticketNumber}</span>
                </div>
                <div className="digtix-card__col digtix-card__col--expiry">
                  <span className="digtix-card__item-header">Expires</span>
                  <span className="digtix-card__item-text">{formatExpiry(r.expiresAt)}</span>
                </div>
                <div className="digtix-card__col digtix-card__col--status">
                  <span className={`digtix-card__pill ${r.pill.className}`}>
                    {r.pill.label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Bezel>
  );
}
