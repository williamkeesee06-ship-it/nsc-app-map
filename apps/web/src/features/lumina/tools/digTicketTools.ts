/**
 * Tools: startDigTicket / listExpiringTickets / getDigTicketStatus
 *
 * The 811 Dig Ticket Manager is a full tab in the app. These three tools
 * let Lumina drive it end-to-end:
 *
 *   - startDigTicket → navigate to /?tab=811 with a ticketId + openModal
 *     query param that TicketDetail reads on mount and pops the IticModal.
 *   - listExpiringTickets → return tickets in the filed/active phase
 *     within the next N days (default 7) or already expired.
 *   - getDigTicketStatus → look up one ticket by workOrder and return
 *     the fields Billy typically asks about.
 *
 * Lookups: /api/dig-tickets (existing endpoint) already returns every
 * ticket; we filter client-side rather than adding a new server query
 * (matches the pattern in ActiveDigTicketsCard). Job lookup uses the
 * existing /api/jobs endpoint via api.listJobs.
 */

import type { DigTicket, Job } from "@nsc/types";
import { api } from "../../../lib/api.js";
import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Statuses that count as "active" for expiration purposes. Drafting/Filing/
// Review haven't been submitted yet; Failed/Expired aren't running. Only
// Filed / Active / Expiring have a live 45-day clock on Billy's job site.
const LIVE_STATUSES = new Set(["Filed", "Active", "Expiring"]);

async function findTicketByJobNumber(
  jobNumber: string
): Promise<{ ticket: DigTicket | null; job: Job | null }> {
  // Fetch both — cheap for Billy's dataset size (~hundreds).
  const [ticketsRes, jobsRes] = await Promise.all([
    api.listDigTickets(),
    api.listJobs(),
  ]);
  const wo = jobNumber.trim().toUpperCase();
  const job = jobsRes.jobs.find((j) => (j.workOrder ?? "").toUpperCase() === wo) ?? null;
  if (!job) return { ticket: null, job: null };
  // Prefer the job's activeTicketId pointer; fall back to jobId match so
  // Lumina can still find a ticket even if the pointer wasn't set.
  const ticket =
    ticketsRes.tickets.find(
      (t) => t.id === job.activeTicketId || t.jobId === job.jobId
    ) ?? null;
  return { ticket, job };
}

// ─────────────────────────────────────────────────────────────────────────────
// startDigTicket — navigate + open modal
// ─────────────────────────────────────────────────────────────────────────────

interface StartDigTicketInput {
  jobNumber: string;
}

interface StartDigTicketData {
  ticketId: string | null;
  jobNumber: string;
  status: string | null;
  address: string | null;
}

const startDigTicketTool: LuminaTool<StartDigTicketInput, StartDigTicketData> = {
  name: "startDigTicket",
  description:
    "Navigate to the 811 tab, open the dig ticket for the given job number, and pop the Request 811 modal.",
  kind: "navigate",
  async run(input) {
    const jobNumber = input?.jobNumber?.trim();
    if (!jobNumber) {
      return { ok: false, message: "startDigTicket requires jobNumber." };
    }
    const { ticket, job } = await findTicketByJobNumber(jobNumber);
    if (!job) {
      return {
        ok: false,
        message: `No job found matching ${jobNumber}.`,
      };
    }
    if (!ticket) {
      return {
        ok: false,
        message: `No 811 ticket exists yet for ${jobNumber}. Create one from the 811 tab first (Request 811 → pick the job).`,
      };
    }
    // Fire a CustomEvent that DigTicketsTab listens for. This is the least-
    // invasive way to drive the UI from a tool — no router changes needed.
    // If the 811 tab isn't currently mounted, we set a sessionStorage flag
    // so DigTicketsTab picks it up on next mount.
    const detail = { ticketId: ticket.id, openIticModal: true };
    try {
      sessionStorage.setItem("nsc.lumina.openDigTicket", JSON.stringify(detail));
    } catch {
      /* private mode / disabled — event dispatch still works */
    }
    window.dispatchEvent(new CustomEvent("nsc:lumina:openDigTicket", { detail }));
    return {
      ok: true,
      message: `Opening 811 ticket for ${jobNumber} (${ticket.status}).`,
      data: {
        ticketId: ticket.id,
        jobNumber,
        status: ticket.status,
        address: job.address ?? null,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// listExpiringTickets
// ─────────────────────────────────────────────────────────────────────────────

interface ListExpiringInput {
  withinDays?: number;
}

interface ExpiringRow {
  jobNumber: string;
  ticketNumber: string;
  status: string;
  expiresAt: number | null;
  expiresAtISO: string | null;
  daysUntilExpiry: number | null;
  expired: boolean;
}

interface ListExpiringData {
  windowDays: number;
  count: number;
  rows: ExpiringRow[];
}

const listExpiringTicketsTool: LuminaTool<ListExpiringInput, ListExpiringData> = {
  name: "listExpiringTickets",
  description:
    "List 811 dig tickets expiring within N days (default 7) or already expired.",
  kind: "read",
  async run(input) {
    const windowDays = Math.max(1, Math.round(input?.withinDays ?? 7));
    const [ticketsRes, jobsRes] = await Promise.all([
      api.listDigTickets(),
      api.listJobs(),
    ]);
    const jobById = new Map<string, Job>(jobsRes.jobs.map((j) => [j.jobId, j]));
    const now = Date.now();
    const cutoff = now + windowDays * DAY_MS;
    const rows: ExpiringRow[] = ticketsRes.tickets
      .filter((t) => LIVE_STATUSES.has(t.status))
      .map((t) => {
        const exp = t.dates?.expiresAt ?? null;
        const job = jobById.get(t.jobId);
        return {
          jobNumber: job?.workOrder ?? t.jobId,
          ticketNumber: t.ticketNumber || "",
          status: t.status,
          expiresAt: exp,
          expiresAtISO: exp ? new Date(exp).toISOString() : null,
          daysUntilExpiry: exp ? Math.floor((exp - now) / DAY_MS) : null,
          expired: exp !== null && exp < now,
        };
      })
      .filter((r) => r.expiresAt !== null && r.expiresAt <= cutoff)
      .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0));
    return {
      ok: true,
      message:
        rows.length === 0
          ? `No tickets expiring within ${windowDays} days.`
          : `${rows.length} ticket${rows.length === 1 ? "" : "s"} expiring within ${windowDays} days.`,
      data: { windowDays, count: rows.length, rows },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// getDigTicketStatus
// ─────────────────────────────────────────────────────────────────────────────

interface GetStatusInput {
  jobNumber: string;
}

interface GetStatusData {
  jobNumber: string;
  ticketId: string | null;
  ticketNumber: string | null;
  status: string | null;
  address: string | null;
  shapeType: string | null;
  expiresAt: number | null;
  expiresAtISO: string | null;
  daysUntilExpiry: number | null;
  filed: boolean;
}

const getDigTicketStatusTool: LuminaTool<GetStatusInput, GetStatusData> = {
  name: "getDigTicketStatus",
  description:
    "Return the current status of a dig ticket by job number — status, expiresAt, ticket #, address, shape type.",
  kind: "read",
  async run(input) {
    const jobNumber = input?.jobNumber?.trim();
    if (!jobNumber) {
      return { ok: false, message: "getDigTicketStatus requires jobNumber." };
    }
    const { ticket, job } = await findTicketByJobNumber(jobNumber);
    if (!job) {
      return { ok: false, message: `No job found matching ${jobNumber}.` };
    }
    if (!ticket) {
      return {
        ok: true,
        message: `No 811 ticket exists yet for ${jobNumber}.`,
        data: {
          jobNumber,
          ticketId: null,
          ticketNumber: null,
          status: null,
          address: job.address ?? null,
          shapeType: null,
          expiresAt: null,
          expiresAtISO: null,
          daysUntilExpiry: null,
          filed: false,
        },
      };
    }
    const exp = ticket.dates?.expiresAt ?? null;
    const now = Date.now();
    return {
      ok: true,
      message: `${jobNumber}: ${ticket.status}${ticket.ticketNumber ? ` (ITIC #${ticket.ticketNumber})` : ""}.`,
      data: {
        jobNumber,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber || null,
        status: ticket.status,
        address: job.address ?? null,
        shapeType: ticket.shape?.type ?? null,
        expiresAt: exp,
        expiresAtISO: exp ? new Date(exp).toISOString() : null,
        daysUntilExpiry: exp ? Math.floor((exp - now) / DAY_MS) : null,
        filed: LIVE_STATUSES.has(ticket.status),
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// updateDigTicketUtilityStatus
// ─────────────────────────────────────────────────────────────────────────────

interface UpdateUtilityInput {
  jobNumber: string;
  utility: string;
  status: "pending" | "in-progress" | "marked" | "clear" | "conflict";
  notes?: string;
}

interface UpdateUtilityData {
  jobNumber: string;
  ticketId: string;
  utility: string;
  status: string;
  notes?: string;
}

const updateDigTicketUtilityStatusTool: LuminaTool<UpdateUtilityInput, UpdateUtilityData> = {
  name: "updateDigTicketUtilityStatus",
  description:
    "Update/log the locate clearance status of a utility (e.g. gas, water, electric) for a job's 811 ticket.",
  kind: "read",
  async run(input) {
    const jobNumber = input?.jobNumber?.trim();
    const utility = input?.utility?.trim();
    const status = input?.status;
    const notes = input?.notes;

    if (!jobNumber || !utility || !status) {
      return { ok: false, message: "updateDigTicketUtilityStatus requires jobNumber, utility, and status." };
    }

    const { ticket, job } = await findTicketByJobNumber(jobNumber);
    if (!job) {
      return { ok: false, message: `No job found matching ${jobNumber}.` };
    }
    if (!ticket) {
      return { ok: false, message: `No 811 ticket exists yet for ${jobNumber}.` };
    }

    await api.updateUtilityStatus(ticket.id, { utility, status, notes });
    return {
      ok: true,
      message: `Successfully logged status of '${utility}' as '${status}' on 811 ticket for ${jobNumber}.`,
      data: {
        jobNumber,
        ticketId: ticket.id,
        utility,
        status,
        notes,
      },
    };
  },
};

export const digTicketTools: LuminaTool[] = [
  startDigTicketTool,
  listExpiringTicketsTool,
  getDigTicketStatusTool,
  updateDigTicketUtilityStatusTool,
];
