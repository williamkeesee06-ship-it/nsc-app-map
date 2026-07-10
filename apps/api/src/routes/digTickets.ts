// 811 Dig Ticket Manager — CRUD + Gemini marking-instruction generation.
// Tickets live at digTickets/{ticketId}. A ticket snapshots the job's dig
// shape at filing time so later edits to the job's shape don't mutate a
// filed ticket. Smartsheet write-back + the ITIC bot are handled elsewhere.
import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../lib/firestore.js";
import { generateMarkingInstructions } from "../services/markingInstructions.js";
import { normalizeDigShape, canDeleteDigTicket, buildRadiusShape, buildRouteShape } from "@nsc/types";
import type { DigShape, DigTicket, Job, UtilityStatus, ZiplySectionScope } from "@nsc/types";

const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

// Washington's standard one-call utility member categories. Populated Pending
// at draft time; a locator (or the poller) flips each as marks come in.
const DEFAULT_UTILITIES = [
  "Gas",
  "Electric",
  "Water",
  "Sewer",
  "Telecom",
  "Cable TV",
];

function defaultUtilityStatuses(): UtilityStatus[] {
  return DEFAULT_UTILITIES.map((utility) => ({ utility, status: "pending" as const }));
}

// GET /api/dig-tickets — all tickets, newest first (optionally scoped by owner).
router.get("/dig-tickets", async (req, res, next) => {
  try {
    const owner = req.query.owner as string;
    let query: FirebaseFirestore.Query = db().collection("digTickets");
    if (owner && owner !== "*") {
      query = query.where("createdBy", "==", owner);
    }
    const snap = await query.get();
    const tickets = snap.docs
      .map((d) => d.data() as DigTicket)
      .sort((a, b) => (b.dates?.createdAt ?? 0) - (a.dates?.createdAt ?? 0));
    res.json({ tickets, count: tickets.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/dig-tickets/:ticketId
router.get("/dig-tickets/:ticketId", async (req, res, next) => {
  try {
    const doc = await db().collection("digTickets").doc(req.params.ticketId).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const ticket = doc.data() as DigTicket;
    
    // Join job details
    const jobDoc = await db().collection("jobs").doc(ticket.jobId).get();
    const job = jobDoc.exists ? (jobDoc.data() as Job) : null;
    
    res.json({ 
      ticket: {
        ...ticket,
        address: job ? [job.address, job.city, job.zipCode].filter(Boolean).join(", ") : "",
        street: job?.address || "",
        city: job?.city || "",
        zip: job?.zipCode || "",
      }
    });
  } catch (err) {
    next(err);
  }
});

interface CreateBody {
  jobId: string;
  specs: Partial<DigTicket["specs"]>;
  scope?: ZiplySectionScope | null;
}

// POST /api/dig-tickets — create a draft ticket from a job's saved dig shape.
router.post("/dig-tickets", async (req, res, next) => {
  try {
    const body = req.body as CreateBody;
    if (!body?.jobId) {
      res.status(400).json({ error: "jobId is required" });
      return;
    }

    const jobDoc = await db().collection("jobs").doc(body.jobId).get();
    if (!jobDoc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = jobDoc.data() as Job;

    const scope = normalizeScope(body.scope);
    const shape = scope ? buildShapeForScope(job, scope) : normalizeDigShape(job.digPolygon ?? null);
    if (!shape) {
      res.status(400).json({
        error: scope
          ? "Ziply section has no georeferenced shape to file a ticket for"
          : "Job has no dig shape to file a ticket for",
      });
      return;
    }

    // WA state dig tickets are always valid for 45 days — reject any other value.
    if (body.specs?.duration != null && body.specs.duration !== 45) {
      res.status(400).json({ error: "duration must be 45 (WA dig-ticket lifespan)" });
      return;
    }

    const now = Date.now();
    const specs: DigTicket["specs"] = {
      handDigOnly: body.specs?.handDigOnly ?? false,
      directionalBoring: body.specs?.directionalBoring ?? false,
      whiteLined: body.specs?.whiteLined ?? false,
      explosives: body.specs?.explosives ?? false,
      workType: body.specs?.workType ?? job.workType ?? "",
      equipment: Array.isArray(body.specs?.equipment) ? body.specs!.equipment! : [],
      markAround: body.specs?.markAround ?? "",
      startDate: now + 2 * DAY_MS, // ITIC requires 48hr notice
      duration: 45,
    };

    // Best-effort Gemini generation — a ticket can still be drafted (and the
    // instructions hand-edited or regenerated) if the model call fails.
    let marking = { markingInstructions: "", hazardsWarning: "", summaryText: "", safeExcavationGuidelines: [] as string[] };
    try {
      marking = await generateMarkingInstructions(job, shape, specs);
    } catch (genErr) {
      // eslint-disable-next-line no-console
      console.warn("[dig-tickets] Gemini generation failed, drafting empty:", genErr);
    }

    const id = `ticket-${randomUUID()}`;
    const ticket: DigTicket = {
      id,
      ticketNumber: "",
      jobId: body.jobId,
      status: "Drafting",
      shape,
      scope,
      specs,
      markingInstructions: marking.markingInstructions,
      hazardsWarning: marking.hazardsWarning,
      safeGuidelines: marking.safeExcavationGuidelines.join("\n"),
      utilityStatuses: defaultUtilityStatuses(),
      lastCheckedAt: null,
      readyToDig: false,
      automation: {
        reviewScreenshotUrl: "",
        confirmationScreenshotUrl: null,
        botRunId: "",
        filedAt: null,
        botErrors: [],
      },
      dates: {
        createdAt: now,
        submittedAt: null,
        startsAt: null,
        expiresAt: null,
      },
      createdBy: (req.body?.createdBy as string) || job.constructionSupervisor || "William",
    };

    await db().collection("digTickets").doc(id).set(ticket);
    // Point the job (legacy whole-job) or section object (Ziply scoped tickets)
    // at its active ticket.
    if (scope) {
      const layer = job.ziplyPrintLayer;
      const mo = layer?.mapObjects;
      if (layer && mo) {
        if (scope.kind === "terminal") {
          const t = mo.terminals?.find((x) => x.label === scope.ref);
          if (t) t.locateTicketId = id;
        } else if (scope.kind === "cable") {
          const c = mo.cables?.find((x) => x.label === scope.ref);
          if (c) c.locateTicketId = id;
        } else {
          job.activeTicketId = id;
        }
        await db().collection("jobs").doc(body.jobId).update({
          ziplyPrintLayer: layer,
          ...(scope.kind === "hub" ? { activeTicketId: id } : {}),
          lastSyncedAt: now,
        });
      }
    } else {
      await db().collection("jobs").doc(body.jobId).update({ activeTicketId: id });
    }

    res.status(201).json({ ticket });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dig-tickets/:ticketId — partial update (status, specs, edited text).
router.patch("/dig-tickets/:ticketId", async (req, res, next) => {
  try {
    const ref = db().collection("digTickets").doc(req.params.ticketId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const patch = req.body as Partial<DigTicket>;
    // Never allow id/jobId reassignment via PATCH.
    delete (patch as { id?: unknown }).id;
    delete (patch as { jobId?: unknown }).jobId;
    await ref.update(patch as Record<string, unknown>);
    const updated = (await ref.get()).data() as DigTicket;
    if (
      updated.scope &&
      updated.ticketNumber &&
      (updated.status === "Filed" || updated.status === "Active" || updated.status === "Expiring") &&
      updated.dates?.expiresAt
    ) {
      await mirrorLocateOntoZiplySection(updated, updated.id, updated.dates.expiresAt);
    }
    res.json({ ticket: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/dig-tickets/:ticketId — remove a draft/failed/orphaned ticket.
// Only the ticket doc is removed; the job and its dig polygon are untouched.
// Tickets already filed with ITIC (see canDeleteDigTicket) are locked (403).
router.delete("/dig-tickets/:ticketId", async (req, res, next) => {
  try {
    const ref = db().collection("digTickets").doc(req.params.ticketId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const ticket = doc.data() as DigTicket;
    if (!canDeleteDigTicket(ticket)) {
      res.status(403).json({
        error: "Filed tickets cannot be deleted. Only drafts and failed tickets may be removed.",
      });
      return;
    }

    await ref.delete();
    // Clear the job's pointer if it still references this ticket, so the job
    // becomes eligible to file a fresh ticket again. Leaves the dig shape intact.
    const jobRef = db().collection("jobs").doc(ticket.jobId);
    const jobDoc = await jobRef.get();
    if (jobDoc.exists && (jobDoc.data() as Job).activeTicketId === ticket.id) {
      await jobRef.update({ activeTicketId: null });
    }

    res.json({ ok: true, id: ticket.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/dig-tickets/:ticketId/marking-instructions — regenerate via Gemini.
router.post("/dig-tickets/:ticketId/marking-instructions", async (req, res, next) => {
  try {
    const ref = db().collection("digTickets").doc(req.params.ticketId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const ticket = doc.data() as DigTicket;
    const jobDoc = await db().collection("jobs").doc(ticket.jobId).get();
    const job = jobDoc.exists ? (jobDoc.data() as Job) : null;
    if (!job) {
      res.status(404).json({ error: "Associated job not found" });
      return;
    }

    const marking = await generateMarkingInstructions(job, ticket.shape, ticket.specs);
    const update = {
      markingInstructions: marking.markingInstructions,
      hazardsWarning: marking.hazardsWarning,
      safeGuidelines: marking.safeExcavationGuidelines.join("\n"),
    };
    await ref.update(update);
    res.json({ ticket: { ...ticket, ...update } });
  } catch (err) {
    next(err);
  }
});

// POST /api/dig-tickets/:ticketId/utility-status — set one utility's status.
router.post("/dig-tickets/:ticketId/utility-status", async (req, res, next) => {
  try {
    const { utility, status, notes } = req.body as {
      utility?: string;
      status?: UtilityStatus["status"];
      notes?: string;
    };
    const valid: UtilityStatus["status"][] = ["pending", "in-progress", "marked", "clear", "conflict"];
    if (!utility || !status || !valid.includes(status)) {
      res.status(400).json({ error: "utility and a valid status are required" });
      return;
    }
    const ref = db().collection("digTickets").doc(req.params.ticketId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const ticket = doc.data() as DigTicket;
    const now = Date.now();
    const statuses = [...ticket.utilityStatuses];
    const idx = statuses.findIndex((s) => s.utility === utility);
    const entry: UtilityStatus = {
      utility,
      status,
      respondedAt: now,
      lastCheckedAt: now,
      ...(notes ? { notes } : {}),
    };
    if (idx >= 0) statuses[idx] = entry;
    else statuses.push(entry);

    // ready-to-dig once every utility is resolved (marked or clear) and the
    // 48hr start date has passed.
    const allResolved = statuses.every((s) => s.status === "marked" || s.status === "clear");
    const startPassed = now >= ticket.specs.startDate;
    const readyToDig = allResolved && startPassed;

    await ref.update({ utilityStatuses: statuses, lastCheckedAt: now, readyToDig });
    res.json({ ticket: { ...ticket, utilityStatuses: statuses, lastCheckedAt: now, readyToDig } });
  } catch (err) {
    next(err);
  }
});

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

// POST /api/dig-tickets/:ticketId/file — complete the filing process
router.post("/dig-tickets/:ticketId/file", async (req, res, next) => {
  try {
    const { ticketNumber } = req.body as { ticketNumber?: string };
    if (!ticketNumber) {
      res.status(400).json({ error: "ticketNumber is required" });
      return;
    }
    const ref = db().collection("digTickets").doc(req.params.ticketId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const ticket = doc.data() as DigTicket;
    
    const now = Date.now();
    const startsAt = addBusinessDays(new Date(now), 2).getTime();
    const expiresAt = startsAt + ticket.specs.duration * DAY_MS;
    
    const update = {
      ticketNumber,
      status: "Filed" as const,
      dates: {
        ...ticket.dates,
        submittedAt: now,
        startsAt,
        expiresAt,
      }
    };
    
    await ref.update(update);
    await mirrorLocateOntoZiplySection(ticket, ticket.id, expiresAt);
    res.json({ ticket: { ...ticket, ...update } });
  } catch (err) {
    next(err);
  }
});

export default router;

function normalizeScope(scope: ZiplySectionScope | null | undefined): ZiplySectionScope | null {
  if (!scope?.kind || !scope.ref) return null;
  if (!["hub", "terminal", "cable"].includes(scope.kind)) return null;
  return {
    kind: scope.kind,
    ref: String(scope.ref),
    hubId: scope.hubId ?? null,
    label: scope.label ?? null,
    terminalRange: scope.terminalRange ?? null,
  };
}

function buildShapeForScope(job: Job, scope: ZiplySectionScope): DigShape | null {
  const layer = job.ziplyPrintLayer;
  const mo = layer?.mapObjects;
  const hubLat = mo?.hub?.lat ?? job.geocode?.lat ?? null;
  const hubLng = mo?.hub?.lng ?? job.geocode?.lng ?? null;
  const drawnBy = "ziply-section-scope";

  if (scope.kind === "hub") {
    return hubLat != null && hubLng != null
      ? buildRadiusShape({ lat: hubLat, lng: hubLng }, 125, drawnBy)
      : normalizeDigShape(job.digPolygon ?? null);
  }

  if (scope.kind === "terminal") {
    const term = mo?.terminals?.find((t) => t.label === scope.ref);
    if (term?.lat != null && term.lng != null) {
      return buildRadiusShape({ lat: term.lat, lng: term.lng }, 100, drawnBy);
    }
    if (hubLat != null && hubLng != null) {
      return buildRadiusShape({ lat: hubLat, lng: hubLng }, 100, drawnBy);
    }
  }

  if (scope.kind === "cable") {
    const cable = mo?.cables?.find((c) => c.label === scope.ref);
    if (cable?.path && cable.path.length >= 2) {
      return buildRouteShape(cable.path, 30, drawnBy);
    }
    if (hubLat != null && hubLng != null) {
      return buildRadiusShape({ lat: hubLat, lng: hubLng }, 100, drawnBy);
    }
  }

  return null;
}

async function mirrorLocateOntoZiplySection(
  ticket: DigTicket,
  ticketId: string,
  expiresAt: number
): Promise<void> {
  const scope = ticket.scope;
  if (!scope) return;
  const jobRef = db().collection("jobs").doc(ticket.jobId);
  const jobDoc = await jobRef.get();
  if (!jobDoc.exists) return;
  const job = jobDoc.data() as Job;
  const layer = job.ziplyPrintLayer;
  const mo = layer?.mapObjects;
  if (!layer || !mo) return;
  if (scope.kind === "terminal") {
    const t = mo.terminals?.find((x) => x.label === scope.ref);
    if (t) {
      t.locateTicketId = ticketId;
      t.locateExpires = expiresAt;
    }
  } else if (scope.kind === "cable") {
    const c = mo.cables?.find((x) => x.label === scope.ref);
    if (c) {
      c.locateTicketId = ticketId;
      c.locateExpires = expiresAt;
    }
  } else {
    await jobRef.update({ activeTicketId: ticketId, locateExpires: expiresAt });
    return;
  }
  await jobRef.update({ ziplyPrintLayer: layer, lastSyncedAt: Date.now() });
}
