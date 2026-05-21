// Jobs read/write endpoints. Frontend consumes these to render the Jobs Map + cards.
import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../lib/firestore.js";
import { geocodeAddress } from "../lib/geocode.js";
import { getSheet, buildColumnsById } from "../lib/smartsheet.js";
import { normalizeRow } from "../services/jobsSync.js";
import type { Job } from "@nsc/types";

const router = Router();

// GET /api/jobs/search?q=<term>
// Searches the ENTIRE Smartsheet (no supervisor filter) by Work Order / address /
// city. Use this when /api/jobs (which is supervisor-scoped to Billy) misses a
// job the user knows exists somewhere in the sheet. Returns the standard Job
// shape so the client can drop the result onto the map and open the panel.
//
// For each hit:
//   1. If the job is already in Firestore (was tracked at some point), return
//      that record — it has firstSyncedAt and a cached geocode.
//   2. Otherwise return the normalized row directly. We geocode the top 3 hits
//      inline so the user can immediately jump to them on the map; the rest
//      come back without coords and the client can geocode on demand.
router.get("/jobs/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    if (!q) {
      res.json({ jobs: [], count: 0 });
      return;
    }
    const sheet = await getSheet();
    const colsById = buildColumnsById(sheet);

    // Pull existing Firestore docs into a Map<workOrder, Job> for quick lookup.
    const existingSnap = await db().collection("jobs").get();
    const byWorkOrder = new Map<string, Job>();
    existingSnap.forEach((d) => {
      const j = d.data() as Job;
      if (j.workOrder) byWorkOrder.set(j.workOrder.trim().toLowerCase(), j);
    });

    const hits: Job[] = [];
    for (const row of sheet.rows) {
      const job = normalizeRow(row, colsById);
      if (!job) continue;
      const wo = (job.workOrder || "").toLowerCase();
      const addr = (job.address || "").toLowerCase();
      const city = (job.city || "").toLowerCase();
      const notes = (job.nscProjectNotes || "").toLowerCase();
      if (
        wo.includes(q) ||
        addr.includes(q) ||
        city.includes(q) ||
        notes.includes(q)
      ) {
        const cached = byWorkOrder.get(wo);
        if (cached) {
          hits.push(cached);
        } else {
          // Mark inTracker:false so the client knows this is a sheet-only hit.
          hits.push({ ...job, inTracker: false });
        }
        if (hits.length >= 25) break;
      }
    }

    // Geocode the top 3 uncached hits so the map can fly to them immediately.
    const toGeocode = hits
      .filter((h) => !h.geocode && h.address)
      .slice(0, 3);
    await Promise.all(
      toGeocode.map(async (h) => {
        try {
          const fullAddr = [h.address, h.city, h.zipCode]
            .filter(Boolean)
            .join(", ");
          const g = await geocodeAddress(fullAddr);
          if (g.status === "OK") {
            h.geocode = {
              lat: g.lat,
              lng: g.lng,
              formattedAddress: g.formattedAddress ?? fullAddr,
              sourceAddress: fullAddr,
              cachedAt: Date.now(),
              status: "OK",
            };
          }
        } catch {
          // Best-effort — silent failure leaves geocode null.
        }
      })
    );

    res.json({ jobs: hits, count: hits.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs
// Returns all jobs. The client filters in-memory \u2014 191 records is trivial.
// Optional query: ?inTracker=true to limit to currently-tracked jobs.
router.get("/jobs", async (req, res, next) => {
  try {
    const snap = await db().collection("jobs").get();
    const all = snap.docs.map((d) => d.data() as Job);
    const inTrackerFilter = req.query.inTracker;
    const jobs =
      inTrackerFilter === "true"
        ? all.filter((j) => j.inTracker)
        : inTrackerFilter === "false"
          ? all.filter((j) => !j.inTracker)
          : all;
    res.json({ jobs, count: jobs.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/:jobId
router.get("/jobs/:jobId", async (req, res, next) => {
  try {
    const doc = await db().collection("jobs").doc(req.params.jobId).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ job: doc.data() as Job });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs — create a manual job record (not from Smartsheet)
router.post("/jobs", async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const workOrder = typeof body.workOrder === "string" ? body.workOrder.trim() : "";
    const jobName = typeof body.jobName === "string" ? body.jobName.trim() : "";
    if (!workOrder || !jobName) {
      res.status(400).json({ error: "workOrder and jobName are required" });
      return;
    }

    const address = typeof body.address === "string" ? body.address.trim() : undefined;
    let lat = typeof body.lat === "number" ? body.lat : undefined;
    let lng = typeof body.lng === "number" ? body.lng : undefined;

    // Geocode from address if coords not supplied
    if ((!lat || !lng) && address) {
      try {
        const geo = await geocodeAddress(address);
        if (geo.status === "OK") {
          lat = geo.lat;
          lng = geo.lng;
        }
      } catch {
        // Geocoding failure is non-fatal — save without coords
      }
    }

    const jobId = `manual-${randomUUID()}`;
    const now = Date.now();

    const job: Job = {
      jobId,
      workOrder,
      smartsheetRowId: 0,
      inTracker: false,
      jobStatus: "Manual",
      secondaryJobStatus: "Needs Fielding",
      workType: null,
      workTypeTags: [],
      constructionSupervisor: null,
      constructionManager: null,
      constructionBase: null,
      customerProject: null,
      wireCenter: null,
      address: address ?? null,
      city: null,
      zipCode: null,
      scheduleDate: null,
      actualCompletionDate: null,
      trafficControlRequired: null,
      constructionCrewForeman: null,
      nscProjectNotes: jobName,
      dateReceived: null,
      actualStartDate: null,
      permitRequired: null,
      splicingStatus: null,
      smartsheetModified: null,
      firstSyncedAt: now,
      lastSyncedAt: now,
      geocode:
        lat !== undefined && lng !== undefined
          ? {
              lat,
              lng,
              formattedAddress: address ?? "",
              sourceAddress: address ?? "",
              cachedAt: now,
              status: "OK",
            }
          : null,
    };

    await db().collection("jobs").doc(jobId).set(job);

    res.status(201).json({ jobId, workOrder, jobName, lat, lng });
  } catch (err) {
    next(err);
  }
});

export default router;
