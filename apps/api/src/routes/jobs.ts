// Jobs read/write endpoints. Frontend consumes these to render the Jobs Map + cards.
import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../lib/firestore.js";
import { geocodeAddress } from "../lib/geocode.js";
import { getSheet, buildColumnsById } from "../lib/smartsheet.js";
import { normalizeRow } from "../services/jobsSync.js";
import { getEnv } from "../config/env.js";
import type { Job, PolygonData } from "@nsc/types";

const router = Router();

// In-memory cache for /api/jobs to avoid hammering Firestore (free tier =
// 50K reads/day; each /api/jobs call reads ~200 docs). Cache is invalidated
// on every write (POST /api/jobs, sync runs) by calling invalidateJobsCache().
// 60-second TTL is plenty: Smartsheet sync runs on supervisor login + after
// every JobCard edit, both of which call invalidateJobsCache() directly.
let jobsCache: { jobs: Job[]; ts: number } | null = null;
const JOBS_CACHE_TTL_MS = 60 * 1000;

export function invalidateJobsCache(): void {
  jobsCache = null;
}

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

// GET /api/supervisors
// Returns the unique list of valid Construction Supervisor names directly from
// Smartsheet. Used by the login screen to validate the entered name against
// the full sheet (not just Billy's pre-synced Firestore subset). Pulls from
// the column's dropdown options when available; falls back to scanning rows.
router.get("/supervisors", async (_req, res, next) => {
  try {
    const env = getEnv();
    // Source of truth: the SYNC_SUPERVISORS allowlist. We don't expose every
    // name in Smartsheet — only the supervisors who are actually allowed to
    // log into the app. This keeps the login gate tight.
    const supervisors = (env.SYNC_SUPERVISORS || env.SYNC_SUPERVISOR)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    // Phase 9.7: managers see all supervisors and filter by name in the UI.
    const managers = (env.SYNC_MANAGERS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    res.json({ supervisors, managers, count: supervisors.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs
// Returns all jobs. The client filters in-memory \u2014 191 records is trivial.
// Optional query: ?inTracker=true to limit to currently-tracked jobs.
// Optional query: ?fresh=1 to bypass the in-memory cache (used by manual Sync).
//
// Stale-cache fallback: if Firestore throws (quota exhausted, network error,
// etc.) and we have ANY cached data \u2014 even expired \u2014 we serve it with
// stale:true so the tracker stays populated instead of going blank.
router.get("/jobs", async (req, res, next) => {
  try {
    const inTrackerFilter = req.query.inTracker;
    const bypassCache = req.query.fresh === "1" || req.query.fresh === "true";
    const now = Date.now();

    let all: Job[];
    let stale = false;
    let cacheAgeMs = 0;

    if (
      !bypassCache &&
      jobsCache &&
      now - jobsCache.ts < JOBS_CACHE_TTL_MS
    ) {
      // Fresh cache hit \u2014 zero Firestore reads.
      all = jobsCache.jobs;
      cacheAgeMs = now - jobsCache.ts;
    } else {
      try {
        const snap = await db().collection("jobs").get();
        all = snap.docs.map((d) => d.data() as Job);
        jobsCache = { jobs: all, ts: now };
      } catch (firestoreErr) {
        // Firestore failed (likely quota exceeded). Fallback chain:
        //   1. Stale in-memory cache from a previous successful read.
        //   2. Live Smartsheet read \u2014 separate quota from Firestore, so this
        //      keeps the tracker working when Firestore is fully exhausted.
        // eslint-disable-next-line no-console
        console.warn(
          `[jobs] Firestore read failed: ${
            firestoreErr instanceof Error ? firestoreErr.message : String(firestoreErr)
          }`
        );

        if (jobsCache && jobsCache.jobs.length > 0) {
          all = jobsCache.jobs;
          stale = true;
          cacheAgeMs = now - jobsCache.ts;
          // eslint-disable-next-line no-console
          console.warn(
            `[jobs] Serving stale in-memory cache (age=${Math.round(cacheAgeMs / 1000)}s, n=${all.length})`
          );
        } else {
          // No in-memory cache \u2014 hit Smartsheet directly.
          // eslint-disable-next-line no-console
          console.warn("[jobs] No cache available, falling back to Smartsheet direct read");
          try {
            const sheet = await getSheet();
            const colsById = buildColumnsById(sheet);
            const fromSheet: Job[] = [];
            for (const row of sheet.rows) {
              const job = normalizeRow(row, colsById);
              if (!job) continue;
              fromSheet.push(job);
            }
            all = fromSheet;
            stale = true; // pin geocodes are missing; client will fall back to address-based positioning
            cacheAgeMs = 0;
            // Cache the Smartsheet result so subsequent calls within 60s reuse it.
            jobsCache = { jobs: all, ts: now };
            // eslint-disable-next-line no-console
            console.warn(`[jobs] Smartsheet fallback served n=${all.length} rows (no geocodes)`);
          } catch (smartsheetErr) {
            // eslint-disable-next-line no-console
            console.error(
              "[jobs] Smartsheet fallback also failed:",
              smartsheetErr instanceof Error ? smartsheetErr.message : String(smartsheetErr)
            );
            throw firestoreErr; // surface the original Firestore quota error
          }
        }
      }
    }

    const jobs =
      inTrackerFilter === "true"
        ? all.filter((j) => j.inTracker)
        : inTrackerFilter === "false"
          ? all.filter((j) => !j.inTracker)
          : all;

    res.json({
      jobs,
      count: jobs.length,
      stale,
      cacheAgeMs,
    });
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

// PUT /api/jobs/:jobId/dig-polygon — save (or clear) the 811 excavation
// polygon William traced for a job. Body: { polygon: PolygonData | null }.
// The client computes area/perimeter/bounds (via @nsc/types geo helpers) so
// the HUD and the persisted document always agree; we persist as-is.
router.put("/jobs/:jobId/dig-polygon", async (req, res, next) => {
  try {
    const jobId = req.params.jobId;
    const ref = db().collection("jobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const body = req.body as { polygon?: PolygonData | null };
    const polygon = body.polygon ?? null;

    if (polygon !== null) {
      const okVerts =
        Array.isArray(polygon.vertices) &&
        polygon.vertices.length >= 3 &&
        polygon.vertices.every(
          (v) =>
            v &&
            typeof v.lat === "number" &&
            typeof v.lng === "number"
        );
      if (!okVerts) {
        res
          .status(400)
          .json({ error: "polygon.vertices must be an array of >=3 {lat,lng}" });
        return;
      }
    }

    await ref.update({ digPolygon: polygon });
    invalidateJobsCache();

    res.json({ jobId, digPolygon: polygon });
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
    invalidateJobsCache();

    res.status(201).json({ jobId, workOrder, jobName, lat, lng });
  } catch (err) {
    next(err);
  }
});

export default router;
