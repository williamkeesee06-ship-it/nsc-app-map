// Jobs read/write endpoints. Frontend consumes these to render the Jobs Map + cards.
import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../lib/firestore.js";
import { geocodeAddress } from "../lib/geocode.js";
import type { Job } from "@nsc/types";

const router = Router();

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
