// Jobs read/write endpoints. Frontend consumes these to render the Jobs Map + cards.
import { Router } from "express";
import { waitUntil } from "@vercel/functions";
import { randomUUID } from "crypto";
import { db, storageBucket } from "../lib/firestore.js";
import { geocodeAddress, buildAddressString } from "../lib/geocode.js";
import { getSheet, buildColumnsById, updateRowCells } from "../lib/smartsheet.js";
import { normalizeRow } from "../services/jobsSync.js";
import { getEnv } from "../config/env.js";
import { parseZiplyPrint, ZiplyPrintParseError } from "../services/ziplyParser.js";
import type { DigShape, Job, PolygonData, ZiplyObjectStatus, ZiplySectionKind } from "@nsc/types";

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

// GET /api/jobs/ziply-metrics — calculates Ziply contract KPIs & metrics
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
    const crewPerformance: Record<string, { completedBore: number; completedPlacing: number; completedAerial: number }> = {};

    for (const j of jobs) {
      // Footages
      totalBoreEst += j.estBoreFt ?? 0;
      totalBoreComp += j.completedBoreFt ?? 0;
      totalPlacingEst += j.estPlacingFt ?? 0;
      totalPlacingComp += j.completedPlacingFt ?? 0;
      totalAerialEst += j.estAerialFt ?? 0;
      totalAerialComp += j.completedAerialFt ?? 0;

      // Drops
      totalDropsEst += j.homesPassed ?? 0; // # Homes Passed acts as drop target
      if (j.jobStatus === "Billing Complete" || j.jobStatus === "All Construction Complete") {
        totalDropsComp += j.homesPassed ?? 0;
      }

      // Hub Progress
      const hub = j.hubNumber || "Unknown Hub";
      if (!hubProgress[hub]) {
        hubProgress[hub] = { total: 0, completed: 0 };
      }
      hubProgress[hub].total += (j.estBoreFt ?? 0) + (j.estPlacingFt ?? 0) + (j.estAerialFt ?? 0);
      hubProgress[hub].completed += (j.completedBoreFt ?? 0) + (j.completedPlacingFt ?? 0) + (j.completedAerialFt ?? 0);

      // Crew Performance
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

    // Convert Hub Progress to percentages
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

async function processZiplyIngest(jobId: string, body: ZiplyIngestRequestBody): Promise<void> {
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

    let hubCoords = await geocodeOne(parsed.hubAddress ?? null);
    if (!hubCoords && existing.geocode?.status === "OK") {
      hubCoords = { lat: existing.geocode.lat, lng: existing.geocode.lng };
    }

    const rawTerminals = parsed.mapObjects?.terminals ?? [];
    const terminals = [];
    for (const t of rawTerminals) {
      const firstAddr = t.addressesServed?.[0] ?? null;
      const coords = firstAddr ? await geocodeOne(firstAddr) : null;
      terminals.push({
        label: t.label,
        type: t.type,
        portCount: t.portCount ?? null,
        footageFt: t.footageFt ?? null,
        footageLabel: t.footageLabel ?? null,
        dvftpRange: t.dvftpRange ?? null,
        code: t.code ?? null,
        fiberSpec: t.fiberSpec ?? null,
        addressesServed: t.addressesServed ?? null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        status: "planned" as ZiplyObjectStatus,
      });
    }

    const cables = (parsed.mapObjects?.cables ?? []).map((c) => ({
      label: c.label,
      fiberCount: c.fiberCount,
      lengthFt: c.lengthFt,
      path: null,
      buildType: c.buildType ?? null,
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
          hub: { lat: hubCoords?.lat ?? null, lng: hubCoords?.lng ?? null, status: "planned" },
          cables,
          terminals,
          notes: parsed.mapObjects?.notes ?? null,
        },
        uploadedPermitDocs: {}
      }
    };

    await ref.update(updates);
    invalidateJobsCache();
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

    // NOTE: Smartsheet row propagation is disabled per user request.
    // We only record production locally in Firestore until explicitly approved.

    res.json({ ok: true, jobId, completedBoreFt: newBore, completedPlacingFt: newPlacing, completedAerialFt: newAerial });
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

// POST /api/jobs/:jobId/permits — Upload a base64 permit PDF/image
router.post("/jobs/:jobId/permits", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { permitType, fileDataUrl } = req.body as { permitType: string; fileDataUrl: string };

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
      uploadedPermitDocs: {}
    };

    const uploadedDocs = layer.uploadedPermitDocs || {};
    uploadedDocs[permitType] = fileDataUrl;

    const updates: Partial<Job> = {
      ziplyPrintLayer: {
        ...layer,
        uploadedPermitDocs: uploadedDocs
      },
      lastSyncedAt: Date.now()
    };

    await ref.update(updates);
    invalidateJobsCache();

    res.json({ ok: true, jobId, permitType });
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
