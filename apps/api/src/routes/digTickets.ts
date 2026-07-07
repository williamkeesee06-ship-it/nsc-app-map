// 811 Dig Ticket Manager — CRUD + Gemini marking-instruction generation.
// Tickets live at digTickets/{ticketId}. A ticket snapshots the job's dig
// shape at filing time so later edits to the job's shape don't mutate a
// filed ticket. Smartsheet write-back + the ITIC bot are handled elsewhere.
import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../lib/firestore.js";
import { generateMarkingInstructions } from "../services/markingInstructions.js";
import { normalizeDigShape, canDeleteDigTicket } from "@nsc/types";
import type { DigTicket, Job, UtilityStatus } from "@nsc/types";

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

    const shape = normalizeDigShape(job.digPolygon ?? null);
    if (!shape) {
      res.status(400).json({ error: "Job has no dig shape to file a ticket for" });
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
    // Point the job at its active ticket.
    await db().collection("jobs").doc(body.jobId).update({ activeTicketId: id });

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
    res.json({ ticket: { ...ticket, ...update } });
  } catch (err) {
    next(err);
  }
});

export default router;
