// Jobs read/write endpoints. Frontend consumes these to render the Jobs Map + cards.
import { Router } from "express";
import { waitUntil } from "@vercel/functions";
import { randomUUID } from "crypto";
import { db, storageBucket } from "../lib/firestore.js";
import {
  geocodeAddress,
  buildAddressString,
  cityCenterFallback,
} from "../lib/geocode.js";
import { routeAlongRoads } from "../lib/directions.js";
import {
  expandHouseAddresses,
  GOLD_PLANT_SEEDS,
  distM,
} from "../services/ziplyPlantEngine.js";
import {
  registerPlant,
  orderControls,
  buildRegisteredLateral,
  type SheetControl,
} from "../services/ziplySheetRegister.js";
import {
  getSheet,
  buildColumnsById,
  buildColumnsByTitle,
  updateRowCells,
  findRowByWorkOrder,
} from "../lib/smartsheet.js";
import { normalizeRow } from "../services/jobsSync.js";
import { getEnv } from "../config/env.js";
import {
  parseZiplyPrint,
  parseZiplyPermit,
  ZiplyPrintParseError,
} from "../services/ziplyParser.js";
import type { DigShape, Job, PolygonData, ZiplyObjectStatus, ZiplySectionKind } from "@nsc/types";

type ZiplyPermitFile = NonNullable<
  NonNullable<Job["ziplyPrintLayer"]>["permitFiles"]
>[number];

const PERMIT_TYPE_KEYS = [
  "cityRow",
  "wsdot",
  "county",
  "railroad",
  "pa",
  "tcp",
  "other",
] as const;

/** Pull street name from "18154 Metron Rd, Arlington, WA". */
function extractStreetFromAddress(addr: string | null | undefined): string | null {
  if (!addr?.trim()) return null;
  // Strip leading house number
  const withoutNum = addr
    .trim()
    .replace(/^\d+[A-Za-z]?\s+/, "")
    .split(",")[0]
    ?.trim();
  if (!withoutNum || withoutNum.length < 3) return null;
  // Drop state/zip if still glued
  if (/^(WA|Washington)\b/i.test(withoutNum)) return null;
  return withoutNum;
}

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

// Static /jobs/* paths MUST be registered before /jobs/:jobId or Express
// treats names like "ziply-fidelity" as a jobId and returns 404 Job not found.

// GET /api/jobs/ziply-fidelity — fleet CAD fidelity QA report
router.get("/jobs/ziply-fidelity", async (_req, res, next) => {
  try {
    const { summarizeFleetFidelity } = await import("../services/ziplyFidelity.js");
    const snap = await db()
      .collection("jobs")
      .where("customerProject", "==", "Ziply")
      .get();
    const jobs = snap.docs.map((d) => d.data() as Job);
    res.json({ ok: true, ...summarizeFleetFidelity(jobs) });
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/ziply-metrics — Ziply contract KPIs
router.get("/jobs/ziply-metrics", async (_req, res, next) => {
  try {
    const snap = await db().collection("jobs").where("customerProject", "==", "Ziply").get();
    const jobs = snap.docs.map((d) => d.data() as Job);

    let totalBoreEst = 0;
    let totalBoreComp = 0;
    let totalPlacingEst = 0;
    let totalPlacingComp = 0;
    let totalAerialEst = 0;
    let totalAerialComp = 0;
    let totalDropsEst = 0;
    let totalDropsComp = 0;

    const hubProgress: Record<string, { total: number; completed: number }> = {};
    const crewPerformance: Record<
      string,
      { completedBore: number; completedPlacing: number; completedAerial: number }
    > = {};

    for (const j of jobs) {
      totalBoreEst += j.estBoreFt ?? 0;
      totalBoreComp += j.completedBoreFt ?? 0;
      totalPlacingEst += j.estPlacingFt ?? 0;
      totalPlacingComp += j.completedPlacingFt ?? 0;
      totalAerialEst += j.estAerialFt ?? 0;
      totalAerialComp += j.completedAerialFt ?? 0;

      totalDropsEst += j.homesPassed ?? 0;
      if (j.jobStatus === "Billing Complete" || j.jobStatus === "All Construction Complete") {
        totalDropsComp += j.homesPassed ?? 0;
      }

      const hub = j.hubNumber || "Unknown Hub";
      if (!hubProgress[hub]) hubProgress[hub] = { total: 0, completed: 0 };
      hubProgress[hub].total += (j.estBoreFt ?? 0) + (j.estPlacingFt ?? 0) + (j.estAerialFt ?? 0);
      hubProgress[hub].completed +=
        (j.completedBoreFt ?? 0) + (j.completedPlacingFt ?? 0) + (j.completedAerialFt ?? 0);

      const crew = j.crewName || "Unassigned";
      if (!crewPerformance[crew]) {
        crewPerformance[crew] = { completedBore: 0, completedPlacing: 0, completedAerial: 0 };
      }
      crewPerformance[crew].completedBore += j.completedBoreFt ?? 0;
      crewPerformance[crew].completedPlacing += j.completedPlacingFt ?? 0;
      crewPerformance[crew].completedAerial += j.completedAerialFt ?? 0;
    }

    const ticketsSnap = await db().collection("digTickets").get();
    const now = Date.now();
    const ziplyJobIds = new Set(jobs.map((j) => j.jobId));
    const outstanding811s = ticketsSnap.docs
      .map((d) => d.data() as import("@nsc/types").DigTicket)
      .filter((t) => ziplyJobIds.has(t.jobId))
      .filter((t) => !t.dates?.expiresAt || t.dates.expiresAt <= now || !t.readyToDig)
      .length;

    const hubs = Object.entries(hubProgress).map(([name, stats]) => {
      const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
      return { name, pct, completed: stats.completed, total: stats.total };
    });

    res.json({
      summary: {
        bore: { estimated: totalBoreEst, completed: totalBoreComp },
        placing: { estimated: totalPlacingEst, completed: totalPlacingComp },
        aerial: { estimated: totalAerialEst, completed: totalAerialComp },
        drops: { estimated: totalDropsEst, completed: totalDropsComp },
      },
      hubs,
      crews: crewPerformance,
      outstanding811s,
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
// dig shape William drew for a job. Body: { polygon: DigShape | null }.
// The client computes area/perimeter/bounds/vertices (via @nsc/types geo
// helpers) so the HUD and the persisted document always agree; we validate
// the discriminated union then persist as-is.
router.put("/jobs/:jobId/dig-polygon", async (req, res, next) => {
  try {
    const jobId = req.params.jobId;
    const ref = db().collection("jobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const body = req.body as { polygon?: (DigShape | PolygonData) | null };
    const shape = body.polygon ?? null;

    if (shape !== null) {
      const err = validateDigShape(shape);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    }

    await ref.update({ digPolygon: shape });
    invalidateJobsCache();

    res.json({ jobId, digPolygon: shape });
  } catch (err) {
    next(err);
  }
});

// Validate a DigShape (or legacy bare PolygonData). Returns an error string
// or null when valid. All three tools carry a rendered `vertices` ring, so we
// require that; radius/route additionally carry their source parameters.
function validateDigShape(shape: DigShape | PolygonData): string | null {
  const isLatLngArray = (v: unknown, min: number): boolean =>
    Array.isArray(v) &&
    v.length >= min &&
    v.every(
      (p) =>
        p &&
        typeof (p as { lat: unknown }).lat === "number" &&
        typeof (p as { lng: unknown }).lng === "number"
    );

  if (!isLatLngArray((shape as { vertices?: unknown }).vertices, 3)) {
    return "shape.vertices must be an array of >=3 {lat,lng}";
  }
  const type = (shape as Partial<DigShape>).type;
  if (type === "radius") {
    const s = shape as { center?: unknown; radiusFt?: unknown };
    if (
      !s.center ||
      typeof (s.center as { lat: unknown }).lat !== "number" ||
      typeof (s.center as { lng: unknown }).lng !== "number"
    ) {
      return "radius shape requires a {lat,lng} center";
    }
    if (typeof s.radiusFt !== "number" || s.radiusFt <= 0 || s.radiusFt > 100) {
      return "radiusFt must be a number in (0, 100]";
    }
  } else if (type === "route") {
    const s = shape as { path?: unknown; widthFt?: unknown };
    if (!isLatLngArray(s.path, 2)) {
      return "route shape requires a path of >=2 {lat,lng}";
    }
    if (typeof s.widthFt !== "number" || s.widthFt <= 0 || s.widthFt > 500) {
      return "widthFt must be a number in (0, 500]";
    }
  }
  // polygon and legacy (no type) pass with just the vertices check.
  return null;
}

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



type ZiplyStorageFileRequest = {
  storagePath?: unknown;
  downloadUrl?: unknown;
  contentType?: unknown;
  name?: unknown;
  size?: unknown;
  storageBucket?: unknown;
};

const ZIPLY_SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

function normalizeMimeType(value: unknown): string {
  const mime = typeof value === "string" ? value.split(";")[0]!.trim().toLowerCase() : "";
  return mime || "application/octet-stream";
}

function bufferToDataUrl(buffer: Buffer, contentType: string): string {
  const mimeType = normalizeMimeType(contentType);
  if (!ZIPLY_SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}. Use PDF or JPEG/PNG/WEBP.`);
  }
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

async function downloadZiplyStorageFile(fileRef: ZiplyStorageFileRequest): Promise<string> {
  const storagePath = getString(fileRef.storagePath);
  const bucketName = getString(fileRef.storageBucket);
  const providedContentType = getString(fileRef.contentType);
  const downloadUrl = getString(fileRef.downloadUrl);

  if (storagePath) {
    try {
      const file = storageBucket(bucketName).file(storagePath);
      const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
      const contentType = normalizeMimeType(metadata.contentType ?? providedContentType);
      return bufferToDataUrl(buffer, contentType);
    } catch (err) {
      if (!downloadUrl) throw err;
    }
  }

  if (!downloadUrl) {
    throw new Error("storagePath or downloadUrl required for each uploaded print");
  }

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download uploaded print: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = normalizeMimeType(response.headers.get("content-type") ?? providedContentType);
  return bufferToDataUrl(buffer, contentType);
}

async function resolveZiplyPrintDataUrls(body: {
  dataUrl?: unknown;
  dataUrls?: unknown;
  storageFiles?: unknown;
  storagePaths?: unknown;
  downloadUrls?: unknown;
}): Promise<string[]> {
  const legacyDataUrls = Array.isArray(body.dataUrls)
    ? body.dataUrls.filter((value): value is string => typeof value === "string")
    : typeof body.dataUrl === "string"
      ? [body.dataUrl]
      : [];
  if (legacyDataUrls.length > 0) return legacyDataUrls;

  const fileRefs: ZiplyStorageFileRequest[] = [];
  if (Array.isArray(body.storageFiles)) {
    fileRefs.push(...body.storageFiles.filter((value): value is ZiplyStorageFileRequest => value !== null && typeof value === "object"));
  }
  if (Array.isArray(body.storagePaths)) {
    fileRefs.push(...body.storagePaths.filter((value): value is string => typeof value === "string").map((storagePath) => ({ storagePath })));
  }
  if (Array.isArray(body.downloadUrls)) {
    fileRefs.push(...body.downloadUrls.filter((value): value is string => typeof value === "string").map((downloadUrl) => ({ downloadUrl })));
  }

  if (fileRefs.length === 0) return [];
  return Promise.all(fileRefs.map(downloadZiplyStorageFile));
}

type ZiplyIngestRequestBody = {
  dataUrl?: unknown;
  dataUrls?: unknown;
  storageFiles?: unknown;
  storagePaths?: unknown;
  downloadUrls?: unknown;
};

function sanitizeZiplyStorageFiles(body: ZiplyIngestRequestBody) {
  const files: Array<{
    storagePath?: string;
    downloadUrl?: string;
    contentType?: string;
    name?: string;
    size?: number;
    storageBucket?: string;
  }> = [];

  if (Array.isArray(body.storageFiles)) {
    for (const value of body.storageFiles) {
      if (value === null || typeof value !== "object") continue;
      const file = value as ZiplyStorageFileRequest;
      const storagePath = getString(file.storagePath);
      const downloadUrl = getString(file.downloadUrl);
      if (!storagePath && !downloadUrl) continue;
      const size = typeof file.size === "number" && Number.isFinite(file.size) ? file.size : undefined;
      files.push({
        storagePath,
        downloadUrl,
        contentType: getString(file.contentType),
        name: getString(file.name),
        size,
        storageBucket: getString(file.storageBucket),
      });
    }
  }

  if (Array.isArray(body.storagePaths)) {
    for (const value of body.storagePaths) {
      const storagePath = getString(value);
      if (storagePath) files.push({ storagePath });
    }
  }

  if (Array.isArray(body.downloadUrls)) {
    for (const value of body.downloadUrls) {
      const downloadUrl = getString(value);
      if (downloadUrl) files.push({ downloadUrl });
    }
  }

  // Legacy dataUrl/dataUrls payloads can be large, so never mirror them back into
  // Firestore; keep only a count so operators can tell that an ingest was started.
  const legacyDataUrlCount = Array.isArray(body.dataUrls)
    ? body.dataUrls.filter((value) => typeof value === "string").length
    : typeof body.dataUrl === "string"
      ? 1
      : 0;

  return { files, legacyDataUrlCount };
}

export async function processZiplyIngest(jobId: string, body: ZiplyIngestRequestBody): Promise<void> {
  const ref = db().collection("jobs").doc(jobId);

  try {
    const urls = await resolveZiplyPrintDataUrls(body);
    if (urls.length === 0) {
      throw new Error("storageFiles required");
    }

    const parsed = await parseZiplyPrint(urls);

    const doc = await ref.get();
    if (!doc.exists) {
      throw new Error("Job not found");
    }
    const existing = doc.data() as Job;

    // ── Georeferencing (spec §1) ─────────────────────────────────────────
    // Place the hub from its print address (falling back to the job's own
    // geocode) and each terminal from its first served address. Geocoding is
    // best-effort: any failure leaves that object's coords null so the client
    // can fall back to a ring layout around the hub.
    const geoCache = new Map<string, { lat: number; lng: number } | null>();
    const geocodeOne = async (raw: string | null): Promise<{ lat: number; lng: number } | null> => {
      const addr = buildAddressString({ address: raw, city: existing.city, zipCode: existing.zipCode });
      if (!addr) return null;
      if (geoCache.has(addr)) return geoCache.get(addr)!;
      const g = await geocodeAddress(addr);
      const coords = g.status === "OK" ? { lat: g.lat, lng: g.lng } : null;
      geoCache.set(addr, coords);
      return coords;
    };

    // Resolve a usable map anchor. Prints with hub:{lat:null,lng:null} never
    // appear on the client — fall through hubAddress → job geocode → job address.
    let hubCoords = await geocodeOne(parsed.hubAddress ?? null);
    if (!hubCoords && existing.geocode?.status === "OK" && existing.geocode.lat && existing.geocode.lng) {
      hubCoords = { lat: existing.geocode.lat, lng: existing.geocode.lng };
    }
    if (!hubCoords) {
      const jobAddr = buildAddressString({
        address: existing.address,
        city: existing.city,
        zipCode: existing.zipCode,
      });
      if (jobAddr) {
        const g = await geocodeAddress(jobAddr);
        if (g.status === "OK") hubCoords = { lat: g.lat, lng: g.lng };
      }
    }

    const mainlineStreet =
      parsed.mainlineStreet ??
      parsed.mapObjects?.mainlineStreet ??
      extractStreetFromAddress(parsed.hubAddress) ??
      extractStreetFromAddress(existing.address) ??
      null;
    const projectCity =
      parsed.projectCity ?? existing.city ?? null;

    const rawTerminals = parsed.mapObjects?.terminals ?? [];
    const terminals = [];
    for (const t of rawTerminals) {
      // Expand house numbers to geocodable addresses using mainline street + city
      const houseNums = t.houseNumbers ?? [];
      const expanded = [
        ...(t.addressesServed ?? []),
        ...houseNums.map((h) => {
          const n = String(h).trim();
          if (!n) return null;
          if (/\d+\s+\w+/.test(n) && /st|rd|ave|dr|ln|way|blvd|ct|pl|metron/i.test(n)) {
            return projectCity ? `${n}, ${projectCity}, WA` : n;
          }
          if (mainlineStreet) {
            return `${n} ${mainlineStreet}, ${projectCity || "WA"}, WA`;
          }
          return projectCity ? `${n}, ${projectCity}, WA` : n;
        }),
      ].filter((a): a is string => !!a && a.trim().length > 0);

      let coords: { lat: number; lng: number } | null = null;
      for (const a of expanded) {
        coords = await geocodeOne(a);
        if (coords) break;
      }
      // Do NOT pin all missing terminals on the hub (that creates a star of zero-length spokes)
      terminals.push({
        label: t.label,
        type: t.type,
        portCount: t.portCount ?? null,
        footageFt: t.footageFt ?? null,
        footageLabel: t.footageLabel ?? null,
        dvftpRange: t.dvftpRange ?? null,
        code: t.code ?? null,
        fiberSpec: t.fiberSpec ?? null,
        addressesServed: expanded.length ? expanded : t.addressesServed ?? null,
        houseNumbers: houseNums.length ? houseNums : null,
        sheetPage: t.sheetPage ?? null,
        sequenceOrder: t.sequenceOrder ?? null,
        side: t.side ?? null,
        stationFt: typeof t.stationFt === "number" ? t.stationFt : null,
        offsetFt: typeof t.offsetFt === "number" ? t.offsetFt : null,
        sheetX: typeof t.sheetX === "number" ? t.sheetX : null,
        sheetY: typeof t.sheetY === "number" ? t.sheetY : null,
        crossStreet: typeof t.crossStreet === "string" ? t.crossStreet : null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        status: "planned" as ZiplyObjectStatus,
      });
    }

    const cables = (parsed.mapObjects?.cables ?? []).map((c) => ({
      label: c.label,
      fiberCount: c.fiberCount,
      lengthFt: c.lengthFt,
      path: null as Array<{ lat: number; lng: number }> | null,
      buildType: c.buildType ?? null,
      role: c.role ?? null,
      toTerminal: c.toTerminal ?? null,
      routeStreets: c.routeStreets ?? (mainlineStreet ? [mainlineStreet] : null),
      sheetPage: c.sheetPage ?? null,
      sequenceOrder: c.sequenceOrder ?? null,
      side: c.side ?? null,
      stationFt: typeof c.stationFt === "number" ? c.stationFt : null,
      status: "planned" as ZiplyObjectStatus,
    }));

    const now = Date.now();
    const updates: Partial<Job> = {
      hubNumber: parsed.hubId,
      customerProject: "Ziply",
      ziplyInspector: parsed.ziplyInspector ?? parsed.hubTypeSize,
      homesPassed: parsed.drops?.total ?? null,
      softscapeBuriedHomes: parsed.drops?.lu ?? null,
      softscapeAerialHomes: parsed.drops?.mdu ?? null,
      nscProjectNotes: parsed.specialNotes ?? null,
      lastSyncedAt: now,
      ziplyIngest: {
        ...(existing.ziplyIngest ?? {}),
        status: "complete",
        updatedAt: now,
        completedAt: now,
        errorMessage: null,
        errorCode: null,
        parsed,
      },
      ziplyPrintLayer: {
        hubId: parsed.hubId,
        hubTypeSize: parsed.hubTypeSize,
        terminalCount: parsed.terminalCount,
        fiberCountsPerCable: parsed.fiberCountsPerCable,
        drops: parsed.drops,
        permittedExcavationMethods: parsed.permittedExcavationMethods,
        strandType: parsed.strandType,
        conduitSize: parsed.conduitSize,
        specialNotes: parsed.specialNotes,
        permits: parsed.permits,
        mapObjects: {
          hub: {
            lat: hubCoords?.lat ?? null,
            lng: hubCoords?.lng ?? null,
            status: "planned",
          },
          mainlineStreet,
          backbonePath: null,
          cables,
          terminals,
          notes: parsed.mapObjects?.notes ?? null,
        },
        // Preserve any permit docs already uploaded on this job.
        uploadedPermitDocs: existing.ziplyPrintLayer?.uploadedPermitDocs ?? {},
        permitFiles: existing.ziplyPrintLayer?.permitFiles ?? [],
      },
    };

    // If we resolved hub coords and the job never had a geocode, cache it so
    // pins + print layer stay aligned after future syncs.
    if (hubCoords && !(existing.geocode?.status === "OK")) {
      updates.geocode = {
        lat: hubCoords.lat,
        lng: hubCoords.lng,
        formattedAddress: parsed.hubAddress ?? existing.address ?? "",
        sourceAddress: parsed.hubAddress ?? existing.address ?? "",
        cachedAt: now,
        status: "OK",
      };
    }
    // Fill blank job address/city from print title block (Arlington Metron etc.)
    if (parsed.hubAddress && !existing.address) {
      updates.address = parsed.hubAddress;
    }
    if (projectCity && !existing.city) {
      updates.city = projectCity;
    }

    await ref.update(updates);
    invalidateJobsCache();

    // Auto-run arterial CAD enhance after successful parse (best-effort).
    try {
      const fresh = (await ref.get()).data() as Job;
      if (fresh?.ziplyPrintLayer?.mapObjects) {
        await enhanceZiplyPrintDetail(fresh);
      }
    } catch (enhanceErr) {
      console.warn(`[ziply-ingest] auto-enhance failed for ${jobId}`, enhanceErr);
    }
  } catch (err) {
    const now = Date.now();
    const statusCode = err instanceof ZiplyPrintParseError ? err.statusCode : undefined;
    const errorCode = err instanceof ZiplyPrintParseError ? err.code : undefined;
    const message = err instanceof Error ? err.message : "Unknown Ziply ingest error";
    console.error(`[ziply-ingest] Background ingest failed for job ${jobId}:`, err);
    await ref.update({
      "ziplyIngest.status": "failed",
      "ziplyIngest.updatedAt": now,
      "ziplyIngest.failedAt": now,
      "ziplyIngest.errorMessage": message,
      "ziplyIngest.errorCode": errorCode ?? null,
      "ziplyIngest.statusCode": statusCode ?? null,
      lastSyncedAt: now,
    });
    invalidateJobsCache();
  }
}

function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

type RepairResult = {
  jobId: string;
  workOrder?: string | null;
  repaired: boolean;
  reason: string;
  lat?: number;
  lng?: number;
  terminalsFixed?: number;
};

/**
 * Fill missing hub/terminal lat/lng for an already-ingested Ziply print so it
 * shows on the map without re-running Gemini.
 */
async function repairZiplyPrintLocation(job: Job): Promise<RepairResult> {
  const jobId = job.jobId;
  const mo = job.ziplyPrintLayer?.mapObjects;
  if (!mo) {
    return { jobId, workOrder: job.workOrder, repaired: false, reason: "no_mapObjects" };
  }

  const hubAlready = isValidLatLng(mo.hub?.lat, mo.hub?.lng);
  const geoAlready =
    job.geocode?.status === "OK" && isValidLatLng(job.geocode.lat, job.geocode.lng);

  const geoCache = new Map<string, { lat: number; lng: number } | null>();
  const geocodeOne = async (raw: string | null): Promise<{ lat: number; lng: number } | null> => {
    if (!raw?.trim()) return null;
    // Try raw string as-is first (often already "123 Main St, Arlington, WA")
    const direct = raw.trim();
    const built = buildAddressString({
      address: raw,
      city: job.city,
      zipCode: job.zipCode,
    });
    const attempts = [direct, built].filter(
      (a, i, arr): a is string => !!a && arr.indexOf(a) === i
    );
    for (const addr of attempts) {
      if (geoCache.has(addr)) {
        const hit = geoCache.get(addr)!;
        if (hit) return hit;
        continue;
      }
      const g = await geocodeAddress(addr);
      const coords = g.status === "OK" ? { lat: g.lat, lng: g.lng } : null;
      geoCache.set(addr, coords);
      if (coords) return coords;
    }
    return null;
  };

  // Prefer existing good coords, then geocode candidates.
  let hubCoords: { lat: number; lng: number } | null = null;
  let repairSource = hubAlready ? "hub_existing" : geoAlready ? "job_geocode" : "";
  if (hubAlready) {
    hubCoords = { lat: mo.hub!.lat as number, lng: mo.hub!.lng as number };
  } else if (geoAlready) {
    hubCoords = { lat: job.geocode!.lat, lng: job.geocode!.lng };
  }

  if (!hubCoords) {
    const parsed = job.ziplyIngest?.parsed as {
      hubAddress?: string | null;
      mapObjects?: { terminals?: Array<{ addressesServed?: string[] | null }> };
    } | null | undefined;
    // First terminal street address often geocodes when hub address is missing
    const firstTermAddr =
      mo.terminals?.flatMap((t) => t.addressesServed ?? []).find((a) => a?.trim()) ??
      parsed?.mapObjects?.terminals
        ?.flatMap((t) => t.addressesServed ?? [])
        .find((a) => a?.trim()) ??
      null;

    const candidates = [
      parsed?.hubAddress ?? null,
      job.address,
      firstTermAddr,
      [job.address, job.city, "WA", job.zipCode].filter(Boolean).join(", ") || null,
      job.city ? `${job.city}, Washington` : null,
      job.city ? `${job.city}, WA, USA` : null,
      job.workOrder && job.city ? `${job.workOrder}, ${job.city}, WA` : null,
    ];
    for (const c of candidates) {
      hubCoords = await geocodeOne(c);
      if (hubCoords) {
        repairSource = `geocode:${(c ?? "").slice(0, 48)}`;
        break;
      }
    }
  }

  // Last resort: pin to known North Metro city center so the print is visible
  if (!hubCoords) {
    const parsed = job.ziplyIngest?.parsed as { hubAddress?: string | null } | null | undefined;
    const fallback = cityCenterFallback(job.city, [
      job.address,
      parsed?.hubAddress,
      job.workOrder,
      job.nscProjectNotes,
    ]);
    if (fallback) {
      hubCoords = { lat: fallback.lat, lng: fallback.lng };
      repairSource = fallback.source;
    }
  }

  if (!hubCoords) {
    return {
      jobId,
      workOrder: job.workOrder,
      repaired: false,
      reason: "geocode_failed",
    };
  }

  let terminalsFixed = 0;
  const rawTerms = mo.terminals ?? [];
  const fixedTerminals = [];
  for (let i = 0; i < rawTerms.length; i++) {
    const t = rawTerms[i]!;
    if (isValidLatLng(t.lat, t.lng)) {
      fixedTerminals.push(t);
      continue;
    }
    const firstAddr = t.addressesServed?.[0] ?? null;
    const c = firstAddr ? await geocodeOne(firstAddr) : null;
    terminalsFixed++;
    if (c) {
      fixedTerminals.push({ ...t, lat: c.lat, lng: c.lng });
    } else {
      // Ring around hub so each terminal is distinct and spokes still draw
      const angle = (i * 2 * Math.PI) / Math.max(rawTerms.length, 1);
      const r = 0.00035;
      fixedTerminals.push({
        ...t,
        lat: hubCoords.lat + r * Math.sin(angle),
        lng: hubCoords.lng + r * Math.cos(angle),
      });
    }
  }

  const now = Date.now();
  const layer = {
    ...job.ziplyPrintLayer!,
    mapObjects: {
      ...mo,
      hub: {
        ...(mo.hub ?? {}),
        lat: hubCoords.lat,
        lng: hubCoords.lng,
        status: mo.hub?.status ?? ("planned" as const),
      },
      terminals: fixedTerminals,
      cables: mo.cables ?? [],
      notes: mo.notes ?? null,
    },
  };

  const updates: Record<string, unknown> = {
    ziplyPrintLayer: layer,
    lastSyncedAt: now,
    customerProject: "Ziply",
  };
  if (!geoAlready) {
    updates.geocode = {
      lat: hubCoords.lat,
      lng: hubCoords.lng,
      formattedAddress: job.address ?? "",
      sourceAddress: job.address ?? "",
      cachedAt: now,
      status: "OK",
    };
  }

  await db().collection("jobs").doc(jobId).update(updates);
  return {
    jobId,
    workOrder: job.workOrder,
    repaired: true,
    reason: hubAlready
      ? "terminals_only"
      : repairSource.startsWith("city_center")
        ? `hub_city_fallback:${repairSource}`
        : "hub_and_anchor",
    lat: hubCoords.lat,
    lng: hubCoords.lng,
    terminalsFixed,
  };
}

/** Run async work over items with a concurrency cap (scalability / API rate). */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!, i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/**
 * High-detail geometry pass: geocode every terminal address + route streets,
 * then write multi-point cable paths onto mapObjects so the map is not sticks.
 */
async function enhanceZiplyPrintDetail(job: Job): Promise<{
  jobId: string;
  workOrder?: string | null;
  enhanced: boolean;
  reason: string;
  terminalsGeocoded: number;
  cablesPathed: number;
  waypointsGeocoded: number;
  dropsPlaced: number;
}> {
  const jobId = job.jobId;
  const mo = job.ziplyPrintLayer?.mapObjects;
  if (!mo) {
    return {
      jobId,
      workOrder: job.workOrder,
      enhanced: false,
      reason: "no_mapObjects",
      terminalsGeocoded: 0,
      cablesPathed: 0,
      waypointsGeocoded: 0,
      dropsPlaced: 0,
    };
  }

  const city = job.city;
  const zip = job.zipCode;
  const geoCache = new Map<string, { lat: number; lng: number } | null>();
  const geocodeOne = async (raw: string | null): Promise<{ lat: number; lng: number } | null> => {
    if (!raw?.trim()) return null;
    // Already looks like "street, city" or just street
    const addr =
      buildAddressString({ address: raw, city, zipCode: zip }) ??
      `${raw.trim()}, ${city || "WA"}`;
    if (geoCache.has(addr)) return geoCache.get(addr)!;
    const g = await geocodeAddress(addr);
    const coords = g.status === "OK" ? { lat: g.lat, lng: g.lng } : null;
    geoCache.set(addr, coords);
    return coords;
  };

  // Hub
  let hubCoords: { lat: number; lng: number } | null = null;
  if (isValidLatLng(mo.hub?.lat, mo.hub?.lng)) {
    hubCoords = { lat: mo.hub!.lat as number, lng: mo.hub!.lng as number };
  } else if (job.geocode?.status === "OK" && isValidLatLng(job.geocode.lat, job.geocode.lng)) {
    hubCoords = { lat: job.geocode.lat, lng: job.geocode.lng };
  } else {
    const parsed = job.ziplyIngest?.parsed as { hubAddress?: string | null } | undefined;
    for (const c of [parsed?.hubAddress, job.address, city ? `${city}, WA` : null]) {
      hubCoords = await geocodeOne(c ?? null);
      if (hubCoords) break;
    }
  }
  if (!hubCoords) {
    return {
      jobId,
      workOrder: job.workOrder,
      enhanced: false,
      reason: "geocode_failed",
      terminalsGeocoded: 0,
      cablesPathed: 0,
      waypointsGeocoded: 0,
      dropsPlaced: 0,
    };
  }

  // Terminals — keep real coords; leave null until expand/geocode (no early fan)
  type ZiplyTerm = NonNullable<NonNullable<Job["ziplyPrintLayer"]>["mapObjects"]>["terminals"][number];
  type ZiplyCable = NonNullable<NonNullable<Job["ziplyPrintLayer"]>["mapObjects"]>["cables"][number];
  let terminalsGeocoded = 0;
  const terminals: ZiplyTerm[] = (mo.terminals ?? []).map((t) => {
    const lat = isValidLatLng(t.lat, t.lng) ? (t.lat as number) : null;
    const lng = isValidLatLng(t.lat, t.lng) ? (t.lng as number) : null;
    return { ...t, lat, lng };
  });

  const termByLabel = new Map(terminals.map((t) => [t.label, t]));
  const findTerm = (label: string | null | undefined, fallbackIdx: number) => {
    if (label && termByLabel.has(label)) return termByLabel.get(label)!;
    if (label) {
      const num = label.replace(/\D/g, "");
      if (num) {
        for (const [lab, t] of termByLabel) {
          if (lab.replace(/\D/g, "") === num) return t;
        }
      }
    }
    return terminals[fallbackIdx % Math.max(terminals.length, 1)] ?? null;
  };

  // ── Master plant CAD (Booker arterial + parcel laterals) ────────────────
  const parsedMeta = job.ziplyIngest?.parsed as {
    hubAddress?: string | null;
    mainlineStreet?: string | null;
    projectCity?: string | null;
  } | null;

  const gold = GOLD_PLANT_SEEDS.find((s) =>
    s.match({
      address: job.address ?? parsedMeta?.hubAddress,
      city: job.city ?? parsedMeta?.projectCity,
      workOrder: job.workOrder,
      hubId: job.ziplyPrintLayer?.hubId ?? job.hubNumber,
      notes: job.nscProjectNotes,
    })
  );

  let mainlineStreet =
    mo.mainlineStreet ??
    parsedMeta?.mainlineStreet ??
    gold?.mainlineStreet ??
    extractStreetFromAddress(parsedMeta?.hubAddress) ??
    extractStreetFromAddress(job.address) ??
    null;
  if (!mainlineStreet && gold?.mainlineStreet) mainlineStreet = gold.mainlineStreet;

  const effectiveCity = city || gold?.city || parsedMeta?.projectCity || null;

  // Gold-standard house numbers when AI under-extracted plan sheets
  if (gold && gold.houseNumbers.length > 0) {
    const haveHouses = terminals.some(
      (t) => (t.houseNumbers?.length ?? 0) > 0 || (t.addressesServed?.length ?? 0) > 0
    );
    if (!haveHouses || terminals.length < Math.min(4, gold.houseNumbers.length)) {
      for (const hn of gold.houseNumbers) {
        const exists = terminals.some(
          (t) =>
            t.houseNumbers?.includes(hn) ||
            t.addressesServed?.some((a) => a.includes(hn)) ||
            t.label.includes(hn)
        );
        if (exists) continue;
        const seq = gold.houseNumbers.indexOf(hn) + 1;
        terminals.push({
          label: `LOT-${hn}`,
          type: "service",
          portCount: null,
          footageFt: null,
          footageLabel: null,
          dvftpRange: null,
          code: null,
          fiberSpec: null,
          addressesServed: expandHouseAddresses(
            [hn],
            mainlineStreet,
            effectiveCity,
            null
          ),
          houseNumbers: [hn],
          sequenceOrder: seq,
          stationFt: seq * 100,
          side: seq % 2 === 0 ? "right" : "left",
          lat: null,
          lng: null,
          status: "planned" as ZiplyObjectStatus,
        });
      }
    }
  }

  // Prefer gold hub address for re-geocode if hub still weak
  if (gold?.hubAddress) {
    const gHub = await geocodeOne(gold.hubAddress);
    if (gHub) {
      // Only override if current hub is far from gold hub (>250m) or missing
      if (!isValidLatLng(hubCoords.lat, hubCoords.lng) || distM(hubCoords, gHub) > 250) {
        hubCoords = gHub;
      }
    }
  }

  // Expand addresses on all; geocode missing in parallel (cap concurrency)
  await mapPool(terminals, 5, async (t, ti) => {
    const addrs = expandHouseAddresses(
      t.houseNumbers,
      mainlineStreet,
      effectiveCity,
      t.addressesServed
    );
    let lat = isValidLatLng(t.lat, t.lng) ? (t.lat as number) : null;
    let lng = isValidLatLng(t.lat, t.lng) ? (t.lng as number) : null;
    if (lat == null || lng == null) {
      for (const a of addrs) {
        const g = await geocodeOne(a);
        if (g) {
          lat = g.lat;
          lng = g.lng;
          terminalsGeocoded++;
          break;
        }
      }
    }
    terminals[ti] = {
      ...t,
      addressesServed: addrs.length ? addrs : t.addressesServed,
      lat,
      lng,
    };
    return null;
  });

  // Place still-missing terminals along mainline offset (never all on hub)
  let fanIdx = 0;
  for (let ti = 0; ti < terminals.length; ti++) {
    const t = terminals[ti]!;
    if (isValidLatLng(t.lat, t.lng)) continue;
    const n = Math.max(terminals.length, 4);
    const along = ((fanIdx + 1) / (n + 1) - 0.5) * 0.004; // ~400m span
    const side = fanIdx % 2 === 0 ? 1 : -1;
    const lat = hubCoords.lat + along;
    const lng = hubCoords.lng + side * 0.00035;
    terminals[ti] = { ...t, lat, lng };
    terminalsGeocoded++;
    fanIdx++;
  }

  // Refresh label map after gold + geocode
  termByLabel.clear();
  for (const t of terminals) termByLabel.set(t.label, t);

  // Apply manual field pins (highest priority control truth)
  const manualPins = mo.manualPins ?? [];
  for (const pin of manualPins) {
    if (!isValidLatLng(pin.lat, pin.lng)) continue;
    if (pin.kind === "hub") {
      hubCoords = { lat: pin.lat, lng: pin.lng };
    } else if (pin.kind === "terminal") {
      const idx = terminals.findIndex((t) => t.label === pin.ref);
      if (idx >= 0) {
        terminals[idx] = {
          ...terminals[idx]!,
          lat: pin.lat,
          lng: pin.lng,
          manualPin: true,
          sheetX: pin.sheetX ?? terminals[idx]!.sheetX,
          sheetY: pin.sheetY ?? terminals[idx]!.sheetY,
        };
      }
    }
  }

  // Cross-street geocode: laterals that leave mainline onto named streets
  for (let ti = 0; ti < terminals.length; ti++) {
    const t = terminals[ti]!;
    const cross = t.crossStreet?.trim();
    if (!cross) continue;
    if (isValidLatLng(t.lat, t.lng) && t.manualPin) continue;
    const hn = t.houseNumbers?.[0];
    const crossAddr = hn
      ? `${hn} ${cross}, ${effectiveCity || city || "WA"}, WA`
      : `${cross}, ${effectiveCity || city || "WA"}, WA`;
    const g = await geocodeOne(crossAddr);
    if (g) {
      // Only adopt if closer to hub than 1.4km or replaces missing
      if (!isValidLatLng(t.lat, t.lng) || distM(hubCoords, g) < 1400) {
        terminals[ti] = { ...t, lat: g.lat, lng: g.lng };
        terminalsGeocoded++;
      }
    }
  }

  // Control points = every geocoded terminal (+ hub) — plan-sheet registration truth
  const controls: SheetControl[] = [];
  controls.push({
    id: "hub",
    kind: "hub",
    label: job.ziplyPrintLayer?.hubId || "FDH",
    lat: hubCoords.lat,
    lng: hubCoords.lng,
    sequenceOrder: 0,
    stationFt: 0,
    manual: manualPins.some((p) => p.kind === "hub"),
  });
  for (const t of terminals) {
    if (!isValidLatLng(t.lat, t.lng)) continue;
    controls.push({
      id: t.label,
      kind: "terminal",
      label: t.label,
      lat: t.lat as number,
      lng: t.lng as number,
      stationFt: t.stationFt ?? null,
      offsetFt: t.offsetFt ?? null,
      side: t.side === "left" || t.side === "right" ? t.side : null,
      sequenceOrder: t.sequenceOrder ?? null,
      footageFt: t.footageFt ?? null,
      sheetX: t.sheetX ?? null,
      sheetY: t.sheetY ?? null,
      crossStreet: t.crossStreet ?? null,
      manual: !!t.manualPin || manualPins.some((p) => p.kind === "terminal" && p.ref === t.label),
    });
  }

  // Road-snap backbone through ordered controls (without intermediate waypoints to prevent zig-zagging)
  const orderedCtrls = orderControls(controls, hubCoords);
  let roadBackbone: Array<{ lat: number; lng: number }> | null = null;
  if (orderedCtrls.length >= 2) {
    const origin = { lat: orderedCtrls[0]!.lat, lng: orderedCtrls[0]!.lng };
    const dest = {
      lat: orderedCtrls[orderedCtrls.length - 1]!.lat,
      lng: orderedCtrls[orderedCtrls.length - 1]!.lng,
    };
    roadBackbone = await routeAlongRoads(origin, dest, {
      mode: "walking",
    });
  }

  // Sheet registration — control points + true polyline joins (not star spokes)
  const plant = registerPlant(hubCoords, controls, {
    mainlineStreet,
    padMeters: 45,
    roadBackbone,
  });
  const backbonePath = plant.backbone;
  const geometrySource =
    plant.fidelity === "control_registered"
      ? roadBackbone && roadBackbone.length >= 3
        ? ("road_snapped" as const)
        : ("control_registered" as const)
      : ("synthetic" as const);

  let cablesPathed = 0;
  let waypointsGeocoded = 0;
  const roadsRouted = roadBackbone ? 1 : 0;
  const lateralByLabel = new Map(plant.laterals.map((l) => [l.label, l.path]));
  const cables: ZiplyCable[] = [];

  // Prefer registered lateral geometry — no per-lateral Directions soup
  const sourceCables = mo.cables ?? [];
  for (let i = 0; i < sourceCables.length; i++) {
    const c = sourceCables[i]!;
    const term = findTerm(c.toTerminal ?? c.label, i);
    const termPos =
      term && isValidLatLng(term.lat, term.lng)
        ? { lat: term.lat as number, lng: term.lng as number }
        : null;

    const role =
      c.role ??
      (c.label.toLowerCase().includes("main") || c.label.toLowerCase().includes("feeder")
        ? "mainline"
        : "lateral");

    let path: Array<{ lat: number; lng: number }> | null = null;
    if (role === "mainline" || role === "feeder") {
      path = backbonePath;
      cablesPathed++;
    } else {
      const synth =
        (term && lateralByLabel.get(term.label)) ??
        lateralByLabel.get(c.label) ??
        null;
      if (synth && synth.length >= 2) {
        path = synth;
        cablesPathed++;
      } else if (termPos) {
        // Build on-the-fly registered lateral from control
        const ctrl: SheetControl = {
          id: term?.label ?? c.label,
          kind: "terminal",
          label: term?.label ?? c.label,
          lat: termPos.lat,
          lng: termPos.lng,
          stationFt: term?.stationFt ?? c.stationFt ?? null,
          offsetFt: term?.offsetFt ?? null,
          side:
            term?.side === "left" || term?.side === "right"
              ? term.side
              : c.side === "left" || c.side === "right"
                ? c.side
                : null,
          sequenceOrder: term?.sequenceOrder ?? c.sequenceOrder ?? null,
          footageFt: term?.footageFt ?? c.lengthFt ?? null,
        };
        path = buildRegisteredLateral(backbonePath, ctrl).path;
        cablesPathed++;
      }
    }

    cables.push({
      ...c,
      role,
      path,
      routeStreets: c.routeStreets ?? (mainlineStreet ? [mainlineStreet] : null),
      status: c.status ?? ("planned" as ZiplyObjectStatus),
    });
  }

  // Always one canonical mainline
  const hasMainline = cables.some((c) => c.role === "mainline" || c.role === "feeder");
  if (!hasMainline && backbonePath.length >= 2) {
    cables.unshift({
      label: mainlineStreet ? `MAINLINE · ${mainlineStreet}` : "MAINLINE",
      fiberCount: "",
      lengthFt: null,
      path: backbonePath,
      buildType: "trench",
      role: "mainline",
      toTerminal: null,
      routeStreets: mainlineStreet ? [mainlineStreet] : null,
      status: "planned" as ZiplyObjectStatus,
    });
    cablesPathed++;
  } else {
    for (let i = 0; i < cables.length; i++) {
      if (cables[i]!.role === "mainline" || cables[i]!.role === "feeder") {
        cables[i] = { ...cables[i]!, path: backbonePath };
      }
    }
  }

  // Lateral for every located control not already covered
  const covered = new Set(
    cables.map((c) => c.toTerminal).filter((x): x is string => !!x)
  );
  for (const lat of plant.laterals) {
    if (covered.has(lat.label)) continue;
    if (cables.some((c) => c.toTerminal === lat.label || c.label === lat.label)) continue;
    const term = terminals.find((t) => t.label === lat.label);
    cables.push({
      label: lat.label.startsWith("LOT-") ? `LAT-${lat.label.slice(4)}` : lat.label,
      fiberCount: "",
      lengthFt: term?.footageFt ?? null,
      path: lat.path,
      buildType: "bore",
      role: "lateral",
      toTerminal: lat.label,
      routeStreets: mainlineStreet ? [mainlineStreet] : null,
      stationFt: term?.stationFt ?? null,
      side: term?.side ?? null,
      sequenceOrder: term?.sequenceOrder ?? null,
      status: "planned" as ZiplyObjectStatus,
    });
    cablesPathed++;
  }

  // Write registered coords back onto terminals (control positions)
  for (const tp of plant.terminalPositions) {
    const idx = terminals.findIndex((t) => t.label === tp.label);
    if (idx >= 0) {
      terminals[idx] = { ...terminals[idx]!, lat: tp.lat, lng: tp.lng };
    }
  }

  console.info(
    `[ziply-enhance] job=${jobId} fidelity=${plant.fidelity} source=${geometrySource} ` +
      `controls=${plant.controlCount} residualM=${plant.residualRm?.toFixed(1) ?? "?"} ` +
      `cables=${cablesPathed} roads=${roadsRouted} backbone=${backbonePath.length} ` +
      `mainline=${mainlineStreet ?? "?"} gold=${gold?.projectLabel ?? "none"}`
  );

  // Drops = geocoded house addresses (print-accurate parcels). Cap for enhance time.
  const MAX_DROPS = 48;
  const dropSites: Array<{
    address: string;
    lat: number;
    lng: number;
    terminalLabel?: string | null;
    kind?: "lu" | "mdu" | "bu" | "unknown" | null;
  }> = [];
  const dropSeen = new Set<string>();
  type DropJob = { address: string; terminalLabel: string; reuse?: { lat: number; lng: number } };
  const dropJobs: DropJob[] = [];
  for (const t of terminals) {
    for (const addr of t.addressesServed ?? []) {
      if (!addr?.trim()) continue;
      const key = addr.trim().toLowerCase();
      if (dropSeen.has(key)) continue;
      dropSeen.add(key);
      if (
        isValidLatLng(t.lat, t.lng) &&
        (t.addressesServed?.length ?? 0) === 1
      ) {
        dropJobs.push({
          address: addr.trim(),
          terminalLabel: t.label,
          reuse: { lat: t.lat as number, lng: t.lng as number },
        });
      } else {
        dropJobs.push({ address: addr.trim(), terminalLabel: t.label });
      }
      if (dropJobs.length >= MAX_DROPS) break;
    }
    if (dropJobs.length >= MAX_DROPS) break;
  }
  if (gold && dropJobs.length < MAX_DROPS) {
    for (const hn of gold.houseNumbers) {
      const addrs = expandHouseAddresses([hn], mainlineStreet, effectiveCity, null);
      for (const addr of addrs) {
        const key = addr.toLowerCase();
        if (dropSeen.has(key)) continue;
        dropSeen.add(key);
        dropJobs.push({ address: addr, terminalLabel: `LOT-${hn}` });
        if (dropJobs.length >= MAX_DROPS) break;
      }
      if (dropJobs.length >= MAX_DROPS) break;
    }
  }
  const placedDrops = await mapPool(dropJobs, 5, async (dj) => {
    let g = dj.reuse ?? null;
    if (!g) {
      g = await geocodeOne(dj.address);
      if (g) waypointsGeocoded++;
    }
    if (!g) return null;
    return {
      address: dj.address,
      lat: g.lat,
      lng: g.lng,
      terminalLabel: dj.terminalLabel,
      kind: "lu" as const,
    };
  });
  for (const d of placedDrops) {
    if (d) dropSites.push(d);
  }

  const now = Date.now();
  const layer = {
    ...job.ziplyPrintLayer!,
    printGeometryEnhancedAt: now,
    mapObjects: {
      ...mo,
      hub: {
        ...(mo.hub ?? {}),
        lat: hubCoords.lat,
        lng: hubCoords.lng,
        status: mo.hub?.status ?? ("planned" as const),
      },
      mainlineStreet,
      backbonePath,
      geometrySource,
      geometryResidualM: plant.residualRm ?? null,
      terminals,
      cables,
      dropSites,
      manualPins: mo.manualPins ?? [],
      notes: mo.notes ?? null,
    },
  };

  const updates: Record<string, unknown> = {
    ziplyPrintLayer: layer,
    lastSyncedAt: now,
    customerProject: "Ziply",
  };
  if (!(job.geocode?.status === "OK" && isValidLatLng(job.geocode.lat, job.geocode.lng))) {
    updates.geocode = {
      lat: hubCoords.lat,
      lng: hubCoords.lng,
      formattedAddress: job.address ?? "",
      sourceAddress: job.address ?? "",
      cachedAt: now,
      status: "OK",
    };
  }

  await db().collection("jobs").doc(jobId).update(updates);
  return {
    jobId,
    workOrder: job.workOrder,
    enhanced: true,
    reason: "ok",
    terminalsGeocoded,
    cablesPathed,
    waypointsGeocoded,
    dropsPlaced: dropSites.length,
  };
}

// POST /api/jobs/:jobId/ziply-repair-print — re-geocode hub/terminals for an
// already-ingested print (no Gemini). Makes old prints visible on the map.
router.post("/jobs/:jobId/ziply-repair-print", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const ref = db().collection("jobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = doc.data() as Job;
    if ((job.customerProject ?? "").trim().toLowerCase() !== "ziply" && !job.ziplyPrintLayer?.mapObjects) {
      res.status(400).json({ error: "Not a Ziply job" });
      return;
    }
    if (!job.ziplyPrintLayer?.mapObjects) {
      res.status(400).json({
        error: "No print layer on this job — upload/ingest a print first",
      });
      return;
    }
    const repaired = await repairZiplyPrintLocation(job);
    if (!repaired.repaired) {
      res.json({
        ok: false,
        repaired: false,
        enhanced: false,
        reason: repaired.reason,
        jobId: repaired.jobId,
        workOrder: repaired.workOrder,
        terminalsGeocoded: 0,
        cablesPathed: 0,
        waypointsGeocoded: 0,
        dropsPlaced: 0,
      });
      return;
    }
    const fresh = (await ref.get()).data() as Job;
    const enhanced = await enhanceZiplyPrintDetail(fresh);
    invalidateJobsCache();
    res.json({
      ok: true,
      repaired: true,
      ...enhanced,
      // Keep repair placement reason when enhance succeeds (e.g. city_center fallback)
      reason: enhanced.enhanced ? repaired.reason : enhanced.reason,
      lat: repaired.lat,
      lng: repaired.lng,
      terminalsFixed: repaired.terminalsFixed,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:jobId/ziply-enhance-print — rebuild detailed cable paths + geocodes
router.post("/jobs/:jobId/ziply-enhance-print", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const ref = db().collection("jobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = doc.data() as Job;
    if (!job.ziplyPrintLayer?.mapObjects) {
      res.status(400).json({ error: "No print layer — ingest a print first" });
      return;
    }
    const result = await enhanceZiplyPrintDetail(job);
    invalidateJobsCache();
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/ziply-enhance-prints — batch rebuild plant CAD (Phase A)
// Body optional: { limit?: number, onlyStale?: boolean }
router.post("/jobs/ziply-enhance-prints", async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { limit?: number; onlyStale?: boolean };
    const limit = Math.min(Math.max(body.limit ?? 25, 1), 80);
    const onlyStale = body.onlyStale !== false;
    const snap = await db()
      .collection("jobs")
      .where("customerProject", "==", "Ziply")
      .get();
    const candidates = snap.docs
      .map((d) => d.data() as Job)
      .filter((j) => j.ziplyPrintLayer?.mapObjects)
      .filter((j) => {
        if (!onlyStale) return true;
        const src = j.ziplyPrintLayer?.mapObjects?.geometrySource;
        return !j.ziplyPrintLayer?.printGeometryEnhancedAt || src === "synthetic" || !src;
      })
      .slice(0, limit);

    const results: Array<Record<string, unknown>> = [];
    let enhanced = 0;
    let failed = 0;
    for (const job of candidates) {
      try {
        const r = await enhanceZiplyPrintDetail(job);
        if (r.enhanced) enhanced++;
        else failed++;
        results.push(r);
      } catch (e) {
        failed++;
        results.push({
          jobId: job.jobId,
          enhanced: false,
          reason: e instanceof Error ? e.message : "error",
        });
      }
    }
    invalidateJobsCache();
    res.json({
      ok: true,
      attempted: candidates.length,
      enhanced,
      failed,
      results,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/:jobId/ziply-fidelity — single job fidelity
router.get("/jobs/:jobId/ziply-fidelity", async (req, res, next) => {
  try {
    const { reportJobFidelity } = await import("../services/ziplyFidelity.js");
    const doc = await db().collection("jobs").doc(req.params.jobId).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ ok: true, report: reportJobFidelity(doc.data() as Job) });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:jobId/ziply-control-pin — field control pin (Phase C)
router.post("/jobs/:jobId/ziply-control-pin", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { kind, ref, lat, lng, sheetX, sheetY, reenhance } = req.body as {
      kind?: "hub" | "terminal" | "cable";
      ref?: string;
      lat?: number;
      lng?: number;
      sheetX?: number | null;
      sheetY?: number | null;
      reenhance?: boolean;
    };
    if (!kind || !ref || !isValidLatLng(lat, lng)) {
      res.status(400).json({ error: "kind, ref, lat, lng required" });
      return;
    }
    const dbRef = db().collection("jobs").doc(jobId);
    const doc = await dbRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = doc.data() as Job;
    const mo = job.ziplyPrintLayer?.mapObjects;
    if (!mo) {
      res.status(400).json({ error: "No print layer" });
      return;
    }
    const pins = [...(mo.manualPins ?? [])].filter(
      (p) => !(p.kind === kind && p.ref === ref)
    );
    pins.push({
      kind,
      ref,
      lat: lat as number,
      lng: lng as number,
      sheetX: sheetX ?? null,
      sheetY: sheetY ?? null,
      pinnedAt: Date.now(),
      pinnedBy: (req as { user?: { email?: string } }).user?.email ?? null,
    });
    // Mirror onto terminal/hub immediately
    if (kind === "hub") {
      mo.hub = { ...(mo.hub ?? {}), lat: lat as number, lng: lng as number };
    } else if (kind === "terminal") {
      const terms = [...(mo.terminals ?? [])];
      const ti = terms.findIndex((t) => t.label === ref);
      if (ti >= 0) {
        terms[ti] = {
          ...terms[ti]!,
          lat: lat as number,
          lng: lng as number,
          manualPin: true,
        };
        mo.terminals = terms;
      }
    }
    mo.manualPins = pins;
    await dbRef.update({
      ziplyPrintLayer: { ...job.ziplyPrintLayer, mapObjects: mo },
      lastSyncedAt: Date.now(),
    });
    invalidateJobsCache();

    let enhanceResult: unknown = null;
    if (reenhance !== false) {
      const fresh = (await dbRef.get()).data() as Job;
      try {
        enhanceResult = await enhanceZiplyPrintDetail(fresh);
        invalidateJobsCache();
      } catch (e) {
        enhanceResult = { enhanced: false, reason: e instanceof Error ? e.message : "enhance failed" };
      }
    }
    res.json({ ok: true, jobId, pin: pins[pins.length - 1], enhance: enhanceResult });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/jobs/:jobId/ziply-cable-path — field edit of a single cable polyline.
 * Body: { label: string, path: Array<{lat,lng}> }
 * Lets operators correct laterals until they match the print.
 */
router.post("/jobs/:jobId/ziply-cable-path", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { label, path, role } = req.body as {
      label?: string;
      path?: Array<{ lat: number; lng: number }>;
      role?: "mainline" | "lateral" | "feeder" | null;
    };
    if (!label?.trim() || !Array.isArray(path) || path.length < 2) {
      res.status(400).json({ error: "label and path (≥2 points) required" });
      return;
    }
    const clean = path.filter(
      (p) =>
        typeof p.lat === "number" &&
        typeof p.lng === "number" &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        !(p.lat === 0 && p.lng === 0)
    );
    if (clean.length < 2) {
      res.status(400).json({ error: "path needs ≥2 valid coordinates" });
      return;
    }

    const ref = db().collection("jobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = doc.data() as Job;
    const mo = job.ziplyPrintLayer?.mapObjects;
    if (!mo) {
      res.status(400).json({ error: "No print layer" });
      return;
    }

    const cables = [...(mo.cables ?? [])];
    const idx = cables.findIndex(
      (c) => c.label === label || c.toTerminal === label
    );
    if (idx >= 0) {
      cables[idx] = {
        ...cables[idx]!,
        path: clean,
        role: role ?? cables[idx]!.role ?? "lateral",
      };
    } else {
      cables.push({
        label,
        fiberCount: "",
        lengthFt: null,
        path: clean,
        buildType: "bore",
        role: role ?? "lateral",
        toTerminal: label,
        status: "planned",
      });
    }

    const isMain = role === "mainline" || cables[idx]?.role === "mainline";
    await ref.update({
      ziplyPrintLayer: {
        ...job.ziplyPrintLayer,
        mapObjects: {
          ...mo,
          cables,
          backbonePath: isMain ? clean : mo.backbonePath,
        },
      },
      lastSyncedAt: Date.now(),
    });
    invalidateJobsCache();
    res.json({ ok: true, jobId, label, points: clean.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/ziply-repair-prints — batch-repair all Ziply jobs that have
// print mapObjects but missing/unusable coordinates.
router.post("/jobs/ziply-repair-prints", async (_req, res, next) => {
  try {
    const snap = await db().collection("jobs").where("customerProject", "==", "Ziply").get();
    const results: RepairResult[] = [];
    let repaired = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of snap.docs) {
      const job = doc.data() as Job;
      if (!job.ziplyPrintLayer?.mapObjects) {
        skipped++;
        continue;
      }
      // Always attempt if hub missing or geocode missing — repairZiplyPrintLocation is idempotent-ish
      const hubOk = isValidLatLng(
        job.ziplyPrintLayer.mapObjects.hub?.lat,
        job.ziplyPrintLayer.mapObjects.hub?.lng
      );
      const geoOk =
        job.geocode?.status === "OK" &&
        isValidLatLng(job.geocode.lat, job.geocode.lng);
      if (hubOk && geoOk) {
        skipped++;
        continue;
      }
      try {
        const r = await repairZiplyPrintLocation(job);
        results.push(r);
        if (r.repaired) repaired++;
        else if (r.reason === "geocode_failed") failed++;
        else skipped++;
      } catch (e) {
        failed++;
        results.push({
          jobId: job.jobId,
          workOrder: job.workOrder,
          repaired: false,
          reason: e instanceof Error ? e.message : "error",
        });
      }
    }

    invalidateJobsCache();
    res.json({
      ok: true,
      repaired,
      skipped,
      failed,
      results: results.filter((r) => r.repaired || r.reason === "geocode_failed"),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:jobId/ziply-ingest — starts async Ziply FTTH print parsing.
router.post("/jobs/:jobId/ziply-ingest", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const body = req.body as ZiplyIngestRequestBody;
    const { files, legacyDataUrlCount } = sanitizeZiplyStorageFiles(body);
    if (files.length === 0 && legacyDataUrlCount === 0) {
      res.status(400).json({ error: "storageFiles required" });
      return;
    }

    const ref = db().collection("jobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const now = Date.now();
    await ref.update({
      ziplyIngest: {
        status: "processing",
        startedAt: now,
        updatedAt: now,
        storageFiles: files,
        legacyDataUrlCount,
        errorMessage: null,
        errorCode: null,
      },
      lastSyncedAt: now,
    });
    invalidateJobsCache();

    waitUntil(processZiplyIngest(jobId, body));

    res.status(202).json({ ok: true, jobId, status: "processing" });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:jobId/ziply-object-status — Persist one map object's build
// status (spec §4). kind identifies the family; ref matches the object's label
// (or "hub" for the FDH). Writes into ziplyPrintLayer.mapObjects.
router.post("/jobs/:jobId/ziply-object-status", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { kind, ref: objectRef, status } = req.body as {
      kind?: "hub" | "terminal" | "cable";
      ref?: string;
      status?: ZiplyObjectStatus;
    };
    const validStatus: ZiplyObjectStatus[] = ["planned", "in_progress", "complete"];
    if (!kind || !status || !validStatus.includes(status)) {
      res.status(400).json({ error: "kind and valid status required" });
      return;
    }

    const ref = db().collection("jobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = doc.data() as Job;
    const layer = job.ziplyPrintLayer;
    if (!layer?.mapObjects) {
      res.status(400).json({ error: "Job has no ziply map objects to update" });
      return;
    }

    const mapObjects = layer.mapObjects;
    if (kind === "hub") {
      mapObjects.hub = { ...(mapObjects.hub ?? {}), status };
    } else if (kind === "terminal") {
      const t = mapObjects.terminals?.find((x) => x.label === objectRef);
      if (!t) {
        res.status(404).json({ error: `Terminal ${objectRef} not found` });
        return;
      }
      t.status = status;
    } else {
      const c = mapObjects.cables?.find((x) => x.label === objectRef);
      if (!c) {
        res.status(404).json({ error: `Cable ${objectRef} not found` });
        return;
      }
      c.status = status;
    }

    await ref.update({ ziplyPrintLayer: layer, lastSyncedAt: Date.now() });
    invalidateJobsCache();

    res.json({ ok: true, jobId, ziplyPrintLayer: layer });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:jobId/ziply-production — Logs daily progress and updates Smartsheet row
router.post("/jobs/:jobId/ziply-production", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { completedBoreFt, completedPlacingFt, completedAerialFt, notes } = req.body as {
      completedBoreFt?: number;
      completedPlacingFt?: number;
      completedAerialFt?: number;
      notes?: string;
    };

    const ref = db().collection("jobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = doc.data() as Job;

    // Cumulative production ft
    const newBore = (job.completedBoreFt ?? 0) + (completedBoreFt ?? 0);
    const newPlacing = (job.completedPlacingFt ?? 0) + (completedPlacingFt ?? 0);
    const newAerial = (job.completedAerialFt ?? 0) + (completedAerialFt ?? 0);

    const updates: Partial<Job> = {
      completedBoreFt: newBore,
      completedPlacingFt: newPlacing,
      completedAerialFt: newAerial,
      lastSyncedAt: Date.now(),
    };
    if (notes) {
      updates.nscProjectNotes = notes;
    }

    await ref.update(updates);
    invalidateJobsCache();

    // Opt-in Smartsheet write-back (Phase D) — body.syncSmartsheet === true
    let smartsheet: { ok: boolean; error?: string } | null = null;
    const { syncSmartsheet } = req.body as { syncSmartsheet?: boolean };
    if (syncSmartsheet === true && job.workOrder) {
      try {
        const sheet = await getSheet();
        const row = findRowByWorkOrder(sheet, job.workOrder);
        if (!row) {
          smartsheet = { ok: false, error: "work_order_not_found" };
        } else {
          const cells: Record<string, string | number | null> = {};
          // Best-effort common column titles (sheet schemas vary)
          const tryTitles: Array<[string, number]> = [
            ["Completed Bore Ft", newBore],
            ["Completed Bore", newBore],
            ["Bore Completed", newBore],
            ["Completed Placing Ft", newPlacing],
            ["Completed Placing", newPlacing],
            ["Completed Aerial Ft", newAerial],
            ["Completed Aerial", newAerial],
          ];
          const byTitle = buildColumnsByTitle(sheet);
          for (const [title, value] of tryTitles) {
            if (byTitle.has(title) && !Object.keys(cells).includes(title)) {
              // only first match per metric family
              if (
                title.toLowerCase().includes("bore") &&
                !Object.keys(cells).some((k) => k.toLowerCase().includes("bore"))
              ) {
                cells[title] = value;
              } else if (
                title.toLowerCase().includes("placing") &&
                !Object.keys(cells).some((k) => k.toLowerCase().includes("placing"))
              ) {
                cells[title] = value;
              } else if (
                title.toLowerCase().includes("aerial") &&
                !Object.keys(cells).some((k) => k.toLowerCase().includes("aerial"))
              ) {
                cells[title] = value;
              }
            }
          }
          if (Object.keys(cells).length === 0) {
            smartsheet = { ok: false, error: "no_matching_columns" };
          } else {
            await updateRowCells(row.id, cells, sheet);
            smartsheet = { ok: true };
          }
        }
      } catch (e) {
        smartsheet = {
          ok: false,
          error: e instanceof Error ? e.message : "smartsheet_error",
        };
      }
    }

    res.json({
      ok: true,
      jobId,
      completedBoreFt: newBore,
      completedPlacingFt: newPlacing,
      completedAerialFt: newAerial,
      smartsheet,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:jobId/schedule — Update schedule dates and crew assignment
router.post("/jobs/:jobId/schedule", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { scheduleDate, endDate, constructionCrewForeman } = req.body as {
      scheduleDate?: string | null;
      endDate?: string | null;
      constructionCrewForeman?: string | null;
    };

    let ref = db().collection("jobs").doc(jobId);
    let doc = await ref.get();
    if (!doc.exists) {
      // Fallback: the client might have passed a workOrder instead of a doc ID.
      const snap = await db().collection("jobs").where("workOrder", "==", jobId).limit(1).get();
      if (!snap.empty) {
        ref = snap.docs[0].ref;
        doc = snap.docs[0];
      } else {
        res.status(404).json({ error: "Job not found" });
        return;
      }
    }

    const updates: Partial<Job> = {
      lastSyncedAt: Date.now(),
    };
    if (scheduleDate !== undefined) updates.scheduleDate = scheduleDate;
    if (endDate !== undefined) updates.actualCompletionDate = endDate;
    if (constructionCrewForeman !== undefined) updates.constructionCrewForeman = constructionCrewForeman;

    await ref.update(updates);
    invalidateJobsCache();

    res.json({ ok: true, jobId, scheduleDate, endDate, constructionCrewForeman });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:jobId/marking-instructions — Generate 811 marking instructions
router.post("/jobs/:jobId/marking-instructions", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    let ref = db().collection("jobs").doc(jobId);
    let doc = await ref.get();
    
    if (!doc.exists) {
      const snap = await db().collection("jobs").where("workOrder", "==", jobId).limit(1).get();
      if (!snap.empty) {
        ref = snap.docs[0].ref;
        doc = snap.docs[0];
      } else {
        res.status(404).json({ error: "Job not found" });
        return;
      }
    }

    const job = doc.data() as Job;
    const shape = (job as any).digPolygon as DigShape | undefined;
    
    let instructions = `Please locate and mark all underground utilities for FTTH construction. `;
    instructions += `Project: ${job.customerProject || "Ziply"} ${job.workOrder || ""}. `;
    
    if (job.address) {
      instructions += `Location: ${job.address}, ${job.city || ""}. `;
    }

    if (shape) {
      if (shape.type === "radius") {
        instructions += `Scope: A ${Math.round(Math.sqrt(shape.areaSqFt / Math.PI))} ft radius around the specified coordinates. `;
      } else if (shape.type === "route") {
        instructions += `Scope: A route of approximately ${Math.round(shape.perimeterFt / 2)} ft in length. Mark 10ft on both sides of route. `;
      } else {
        instructions += `Scope: A polygon area of approximately ${Math.round(shape.areaSqFt)} sq ft. `;
      }
    }
    
    if (job.workType) {
      instructions += `Work involves: ${job.workType}. `;
    }
    
    instructions += `Method of excavation: Directional boring and trenching. `;

    res.json({ instructions });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:jobId/permits — legacy base64 upload (kept for old UI).
// Prefer POST /ziply-permit-ingest (Storage + AI parse).
router.post("/jobs/:jobId/permits", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { permitType, fileDataUrl } = req.body as {
      permitType: string;
      fileDataUrl: string;
    };

    if (!permitType || !fileDataUrl) {
      res.status(400).json({ error: "permitType and fileDataUrl are required" });
      return;
    }

    const ref = db().collection("jobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const job = doc.data() as Job;
    const layer = job.ziplyPrintLayer || {
      hubId: job.hubNumber || null,
      hubTypeSize: null,
      terminalCount: null,
      uploadedPermitDocs: {},
    };

    const uploadedDocs = { ...(layer.uploadedPermitDocs || {}) };
    // Do not store huge base64 blobs in Firestore — reject oversized payloads.
    if (fileDataUrl.length > 900_000) {
      res.status(400).json({
        error:
          "Permit file too large for legacy upload. Use the new ENHANCE permit upload (Storage).",
      });
      return;
    }
    uploadedDocs[permitType] = fileDataUrl;

    await ref.update({
      ziplyPrintLayer: {
        ...layer,
        uploadedPermitDocs: uploadedDocs,
      },
      lastSyncedAt: Date.now(),
    });
    invalidateJobsCache();

    res.json({ ok: true, jobId, permitType });
  } catch (err) {
    next(err);
  }
});

async function processZiplyPermitIngest(
  jobId: string,
  permitFileId: string,
  permitType: string,
  body: ZiplyIngestRequestBody
): Promise<void> {
  const ref = db().collection("jobs").doc(jobId);
  try {
    const urls = await resolveZiplyPrintDataUrls(body);
    if (urls.length === 0) throw new Error("storageFiles required");

    const parsed = await parseZiplyPermit(urls, permitType);
    const doc = await ref.get();
    if (!doc.exists) throw new Error("Job not found");
    const job = doc.data() as Job;
    const layer = job.ziplyPrintLayer ?? {
      hubId: job.hubNumber || null,
      hubTypeSize: null,
      terminalCount: null,
    };

    const files: ZiplyPermitFile[] = [...(layer.permitFiles ?? [])];
    const idx = files.findIndex((f) => f.id === permitFileId);
    if (idx < 0) throw new Error("permit file record missing");

    const typeKey =
      (parsed.permitTypeKey &&
      PERMIT_TYPE_KEYS.includes(parsed.permitTypeKey as (typeof PERMIT_TYPE_KEYS)[number])
        ? parsed.permitTypeKey
        : permitType) || "other";

    files[idx] = {
      ...files[idx]!,
      permitType: typeKey,
      ingestStatus: "complete",
      errorMessage: null,
      parsed: {
        permitNumber: parsed.permitNumber,
        permitTypeKey: typeKey,
        issuingAgency: parsed.issuingAgency,
        status: parsed.status,
        issueDate: parsed.issueDate,
        expirationDate: parsed.expirationDate,
        workStartDate: parsed.workStartDate,
        workEndDate: parsed.workEndDate,
        workHours: parsed.workHours,
        workLocation: parsed.workLocation,
        streets: parsed.streets,
        excavationMethods: parsed.excavationMethods,
        trafficControlRequired: parsed.trafficControlRequired,
        conditions: parsed.conditions,
        restrictions: parsed.restrictions,
        contacts: parsed.contacts,
        summary: parsed.summary,
      },
    };

    // Roll parsed status into the permits status board when we know the slot.
    const permits = { ...(layer.permits ?? {}) } as NonNullable<
      NonNullable<Job["ziplyPrintLayer"]>["permits"]
    >;
    if (
      typeKey !== "other" &&
      (typeKey === "cityRow" ||
        typeKey === "wsdot" ||
        typeKey === "county" ||
        typeKey === "railroad" ||
        typeKey === "pa" ||
        typeKey === "tcp")
    ) {
      permits[typeKey] = parsed.status ?? "Approved";
    }

    // Keep a stable download URL on the legacy map for "VIEW DOC" buttons.
    const uploadedDocs = { ...(layer.uploadedPermitDocs ?? {}) };
    const downloadUrl = files[idx]!.downloadUrl;
    if (downloadUrl && typeKey !== "other") {
      uploadedDocs[typeKey] = downloadUrl;
    }

    // Merge excavation methods onto print layer if permit lists them.
    let excav = layer.permittedExcavationMethods ?? [];
    if (parsed.excavationMethods?.length) {
      const set = new Set([...(excav ?? []), ...parsed.excavationMethods]);
      excav = Array.from(set);
    }

    await ref.update({
      ziplyPrintLayer: {
        ...layer,
        permits,
        permittedExcavationMethods: excav,
        uploadedPermitDocs: uploadedDocs,
        permitFiles: files,
      },
      lastSyncedAt: Date.now(),
      customerProject: job.customerProject || "Ziply",
    });
    invalidateJobsCache();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Permit ingest failed";
    console.error(`[ziply-permit-ingest] failed job=${jobId} file=${permitFileId}`, err);
    try {
      const doc = await ref.get();
      if (!doc.exists) return;
      const job = doc.data() as Job;
      const layer = job.ziplyPrintLayer;
      if (!layer?.permitFiles) return;
      const files = layer.permitFiles.map((f) =>
        f.id === permitFileId
          ? { ...f, ingestStatus: "failed" as const, errorMessage: message }
          : f
      );
      await ref.update({
        ziplyPrintLayer: { ...layer, permitFiles: files },
        lastSyncedAt: Date.now(),
      });
      invalidateJobsCache();
    } catch {
      /* ignore secondary failure */
    }
  }
}

// POST /api/jobs/:jobId/ziply-permit-ingest — upload metadata already in Storage;
// AI-parse the permit and attach structured fields to the job.
router.post("/jobs/:jobId/ziply-permit-ingest", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const body = req.body as ZiplyIngestRequestBody & { permitType?: string };
    const permitTypeRaw = String(body.permitType ?? "other").trim() || "other";
    const permitType = PERMIT_TYPE_KEYS.includes(
      permitTypeRaw as (typeof PERMIT_TYPE_KEYS)[number]
    )
      ? permitTypeRaw
      : "other";

    const { files, legacyDataUrlCount } = sanitizeZiplyStorageFiles(body);
    if (files.length === 0 && legacyDataUrlCount === 0) {
      res.status(400).json({ error: "storageFiles required" });
      return;
    }

    const ref = db().collection("jobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = doc.data() as Job;
    const layer = job.ziplyPrintLayer ?? {
      hubId: job.hubNumber || null,
      hubTypeSize: null,
      terminalCount: null,
    };

    const first = files[0];
    const permitFileId = randomUUID();
    const now = Date.now();
    const record: ZiplyPermitFile = {
      id: permitFileId,
      permitType,
      name: first?.name || "permit.pdf",
      downloadUrl: first?.downloadUrl || "",
      storagePath: first?.storagePath ?? null,
      contentType: first?.contentType ?? null,
      size: first?.size ?? null,
      uploadedAt: now,
      ingestStatus: "processing",
      errorMessage: null,
      parsed: null,
    };

    const permitFiles = [...(layer.permitFiles ?? []), record];
    const uploadedDocs = { ...(layer.uploadedPermitDocs ?? {}) };
    if (record.downloadUrl && permitType !== "other") {
      uploadedDocs[permitType] = record.downloadUrl;
    }

    await ref.update({
      ziplyPrintLayer: {
        ...layer,
        permitFiles,
        uploadedPermitDocs: uploadedDocs,
      },
      lastSyncedAt: now,
      customerProject: job.customerProject || "Ziply",
    });
    invalidateJobsCache();

    waitUntil(processZiplyPermitIngest(jobId, permitFileId, permitType, body));

    res.status(202).json({
      ok: true,
      jobId,
      permitFileId,
      status: "processing",
      permitType,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/jobs/:jobId/ziply-section-crew — assign a live crew to one
// hub/terminal/cable section. This deliberately keys by hub + section ref so a
// calendar/Gantt schedule can layer over the same objects later.
router.post("/jobs/:jobId/ziply-section-crew", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { kind, ref: objectRef, crewName } = req.body as {
      kind?: ZiplySectionKind;
      ref?: string;
      crewName?: string | null;
    };
    if (!kind || !["hub", "terminal", "cable"].includes(kind) || !objectRef) {
      res.status(400).json({ error: "kind and ref are required" });
      return;
    }

    const ref = db().collection("jobs").doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = doc.data() as Job;
    const layer = job.ziplyPrintLayer;
    const mapObjects = layer?.mapObjects;
    if (!layer || !mapObjects) {
      res.status(400).json({ error: "Job has no Ziply map objects to assign" });
      return;
    }

    const assignedAt = Date.now();
    const cleanCrew = typeof crewName === "string" && crewName.trim() ? crewName.trim() : null;
    if (kind === "terminal") {
      const t = mapObjects.terminals?.find((x) => x.label === objectRef);
      if (!t) {
        res.status(404).json({ error: `Terminal ${objectRef} not found` });
        return;
      }
      t.crewName = cleanCrew;
      t.crewAssignedAt = cleanCrew ? assignedAt : null;
    } else if (kind === "cable") {
      const c = mapObjects.cables?.find((x) => x.label === objectRef);
      if (!c) {
        res.status(404).json({ error: `Cable ${objectRef} not found` });
        return;
      }
      c.crewName = cleanCrew;
      c.crewAssignedAt = cleanCrew ? assignedAt : null;
    } else {
      job.crewName = cleanCrew;
    }

    await ref.update({
      ...(kind === "hub" ? { crewName: cleanCrew } : { ziplyPrintLayer: layer }),
      lastSyncedAt: assignedAt,
    });
    invalidateJobsCache();
    res.json({ ok: true, jobId, kind, ref: objectRef, crewName: cleanCrew, assignedAt });
  } catch (err) {
    next(err);
  }
});

export default router;
