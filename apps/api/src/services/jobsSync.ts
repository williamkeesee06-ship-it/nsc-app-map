// Smartsheet -> Firestore sync.
// Filters to Construction Supervisor == Billy Keesee (configurable via env).
// Once a job is synced, it stays in Firestore even if it later leaves the
// tracker; we just flip inTracker to false.

import { db } from "../lib/firestore.js";
import { invalidateJobsCache } from "../routes/jobs.js";
import {
  getSheet,
  buildColumnsById,
  rowToRecord,
  type SmartsheetRow,
  type SmartsheetColumn,
} from "../lib/smartsheet.js";
import { geocodeAddress, buildAddressString } from "../lib/geocode.js";
import { getEnv } from "../config/env.js";
import type { Job, JobGeocode, SyncRun } from "@nsc/types";

// Sanitize a Smartsheet Work Order into a Firestore-safe doc id.
// Firestore doc ids: no "/", max 1500 bytes. We replace any non [A-Za-z0-9._-]
// and prefix with "wo_" so it never starts with reserved chars.
export function workOrderToJobId(workOrder: string): string {
  const clean = workOrder.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return `wo_${clean}`;
}

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const str = String(v).trim();
  return str === "" || str.toLowerCase() === "none" ? null : str;
}

function b(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  const str = String(v).trim().toLowerCase();
  if (str === "" || str === "none") return null;
  if (str === "true" || str === "yes" || str === "1") return true;
  if (str === "false" || str === "no" || str === "0") return false;
  return null;
}

function splitWorkType(raw: string | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[,/]/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );
}

// Normalize one Smartsheet row into a Job (no geocode yet).
export function normalizeRow(
  row: SmartsheetRow,
  colsById: Map<number, SmartsheetColumn>,
  isZiply = false
): Job | null {
  const rec = rowToRecord(row, colsById);

  // Ziply reports use "Primary" for the work order id; Lumen sheets use "Work Order".
  // Fall back to Primary so per-supervisor Ziply trackers (which have neither a
  // Work Order column nor a supervisor column) still produce valid Job records.
  const workOrder = s(rec["Work Order"]) ?? s(rec["Primary"]);
  if (!workOrder) return null; // skip rows without a WO/Primary id

  const now = Date.now();

  if (isZiply) {
    const workType = s(rec["Work Type"]);
    let locateExpires: number | null = null;
    const locatesCalledStr = s(rec["Locates Called"]);
    if (locatesCalledStr) {
      const parsed = Date.parse(locatesCalledStr);
      if (!isNaN(parsed)) {
        locateExpires = parsed + 45 * 24 * 60 * 60 * 1000; // 45 days WA locate limit
      }
    }

    // Ziply per-supervisor reports are pre-filtered in Smartsheet, so they do
    // NOT include a supervisor column. The supervisor is stamped by the caller
    // (see sheetsToSync loop) via a defaultSupervisor override.
    return {
      jobId: workOrderToJobId(workOrder),
      workOrder,
      smartsheetRowId: row.id,
      inTracker: true,
      jobStatus: s(rec["Job Status"]),
      secondaryJobStatus: null,
      workType,
      workTypeTags: splitWorkType(workType),
      constructionSupervisor: s(rec["NSC Supervisor"]), // may be null; caller overrides
      constructionManager: s(rec["APM"]),
      constructionBase: null,
      customerProject: "Ziply",
      wireCenter: s(rec["Hub Number"]),
      address: s(rec["Address / Project Name"]),
      city: s(rec["City"]),
      zipCode: null,
      scheduleDate: s(rec["Crew Start Forecast"]),
      actualCompletionDate: s(rec["All Construction Complete"]),
      trafficControlRequired: null,
      constructionCrewForeman: s(rec["Crew"]),
      nscProjectNotes: s(rec["Job Notes"]),
      dateReceived: s(rec["Date Received"]),
      actualStartDate: s(rec["Crew Start Actual"]),
      permitRequired: null,
      splicingStatus: s(rec["Splicing Complete Actual"]) ? "Complete" : "Pending",
      smartsheetModified: s(rec["Modified"]),
      firstSyncedAt: now,
      lastSyncedAt: now,
      geocode: null,

      // Ziply specific fields
      sapSalesOrder: s(rec["SAP Sales Order"]),
      sapContractId: s(rec["SAP Contract ID"]),
      hubNumber: s(rec["Hub Number"]),
      ziplyInspector: s(rec["Ziply Inspector"]),
      homesPassed: rec["# Homes Passed"] != null ? Number(rec["# Homes Passed"]) : null,
      softscapeBuriedHomes: rec["SoftScape Buried Homes"] != null ? Number(rec["SoftScape Buried Homes"]) : null,
      softscapeAerialHomes: rec["SoftScape Aerial Homes"] != null ? Number(rec["SoftScape Aerial Homes"]) : null,
      crewName: s(rec["Crew"]),
      approvedToBuild: b(rec["Approved to Build"]),
      assignedInSiteTracker: b(rec["Assigned in SiteTracker"]),
      locatesCalled: locatesCalledStr,
      estBoreFt: rec["Estimated Bore/Trench Footage"] != null ? Number(rec["Estimated Bore/Trench Footage"]) : null,
      completedBoreFt: rec["Completed Bore/Trench Footage"] != null ? Number(rec["Completed Bore/Trench Footage"]) : null,
      estPlacingFt: rec["Estimated Placing Footage"] != null ? Number(rec["Estimated Placing Footage"]) : null,
      completedPlacingFt: rec["Completed Placing Footage"] != null ? Number(rec["Completed Placing Footage"]) : null,
      estAerialFt: rec["Estimated Aerial Footage"] != null ? Number(rec["Estimated Aerial Footage"]) : null,
      completedAerialFt: rec["Completed Aerial Footage"] != null ? Number(rec["Completed Aerial Footage"]) : null,
      locateNumber: s(rec["Locate Ticket"]),
      locateExpires,

      // Ziply's tracker has a "% Complete" column that field crews update. It
      // ships as either a fractional number (0.42) or a percentage string
      // ("42%"); normalize both to an integer 0–100 for consistent UI.
      percentComplete: parsePercent(rec["% Complete"]),
    };
  }

  const workType = s(rec["Work Type"]);
  return {
    jobId: workOrderToJobId(workOrder),
    workOrder,
    smartsheetRowId: row.id,
    inTracker: true, // any row we see in the current sheet is on-tracker
    jobStatus: s(rec["Job Status"]),
    secondaryJobStatus: s(rec["Secondary Job Status"]),
    workType,
    workTypeTags: splitWorkType(workType),
    constructionSupervisor: s(rec["Construction Supervisor"]),
    constructionManager: s(rec["Construction Manager"]),
    constructionBase: s(rec["Construction Base"]),
    customerProject: s(rec["Customer/Project"]) ?? s(rec["Customer / Project"]),
    wireCenter: s(rec["WIRE CENTER"]),
    address: s(rec["Address"]),
    city: s(rec["City"]),
    zipCode: s(rec["Zip Code"]),
    scheduleDate: s(rec["Schedule Date"]),
    actualCompletionDate: s(rec["Actual Completion Date"]),
    trafficControlRequired: b(rec["Traffic Control Required"]),
    constructionCrewForeman: s(rec["Construction Crew/Forman"]), // sheet uses Forman (sic)
    nscProjectNotes: s(rec["NSC Project Notes"]),
    dateReceived: s(rec["Date Received"]),
    actualStartDate: s(rec["Actual Start Date"]),
    permitRequired: s(rec["Permit Required"]),
    splicingStatus: s(rec["Splicing Status"]),
    smartsheetModified: s(rec["Modified"]),
    firstSyncedAt: now, // overwritten below if already exists
    lastSyncedAt: now,
    geocode: null, // filled below
  };
}

// Parse Smartsheet "% Complete" values — they come through as either 0–1
// fractions (0.42), 0–100 numbers (42), or percent strings ("42%"). We store
// as an integer 0–100 so the dashboard gauge can read it without guessing.
function parsePercent(v: unknown): number | null {
  if (v == null || v === "") return null;
  const raw = typeof v === "string" ? v.replace("%", "").trim() : v;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// Drop any keys whose value is `undefined`. Firestore rejects them.
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export async function runJobsSync(): Promise<SyncRun> {
  const env = getEnv();
  // Default bulk sync uses single SYNC_SUPERVISOR (legacy behaviour).
  return runJobsSyncForSupervisors([env.SYNC_SUPERVISOR]);
}

// Phase 9.7: sync just the rows belonging to the given supervisors.
// Off-tracker flagging is scoped to jobs whose constructionSupervisor matches
// this allowlist, so syncing one supervisor never affects another supervisor's
// jobs in Firestore.
export async function runJobsSyncForSupervisors(
  supervisors: string[]
): Promise<SyncRun> {
  const allowSet = new Set(
    supervisors.map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  if (allowSet.size === 0) {
    throw new Error("runJobsSyncForSupervisors: empty supervisor list");
  }
  const startedAt = Date.now();
  const syncId = `sync_${startedAt}`;
  const firestore = db();

  // Write the running record up front so /api/sync/status sees something.
  const runDoc = firestore.collection("syncRuns").doc(syncId);
  const initial: SyncRun = {
    syncId,
    startedAt,
    finishedAt: null,
    status: "running",
    sheetTotalRows: 0,
    filteredRows: 0,
    upserted: 0,
    flaggedOffTracker: 0,
    geocodedFresh: 0,
    geocodedCached: 0,
    geocodeFailed: 0,
  };
  await runDoc.set(initial);

  try {
    const env = getEnv();
    // Per-source config. `defaultSupervisor` is set for Ziply reports because
    // Smartsheet per-supervisor trackers are pre-filtered and have no
    // supervisor column. When defaultSupervisor is set, we skip the row-level
    // supervisor filter and stamp every row with that supervisor name so the
    // existing UI-side supervisor filtering keeps working.
    const sheetsToSync: Array<{
      id: string;
      supervisorKey: string;
      isZiply: boolean;
      defaultSupervisor?: string;
    }> = [];
    // Lumen sync is DISABLED. Set SYNC_LUMEN=true in Vercel env to re-enable
    // (kept behind a flag rather than deleted so the code path stays exercised).
    if (env.SMARTSHEET_SHEET_ID && env.SYNC_LUMEN === "true") {
      sheetsToSync.push({
        id: env.SMARTSHEET_SHEET_ID,
        supervisorKey: "Construction Supervisor",
        isZiply: false,
      });
    }
    if (env.ZIPLY_SMARTSHEET_SHEET_ID) {
      // Ziply report is Billy's pre-filtered tracker. Every row belongs to Billy.
      sheetsToSync.push({
        id: env.ZIPLY_SMARTSHEET_SHEET_ID,
        supervisorKey: "NSC Supervisor",
        isZiply: true,
        defaultSupervisor: env.ZIPLY_DEFAULT_SUPERVISOR || "Billy Keesee",
      });
    }

    const filteredJobs: Job[] = [];
    let totalRowCount = 0;

    for (const sheetInfo of sheetsToSync) {
      try {
        const sheet = await getSheet({}, sheetInfo.id);
        totalRowCount += sheet.totalRowCount;
        const colsById = buildColumnsById(sheet);

        // If defaultSupervisor is set (pre-filtered report), skip the row-level
        // supervisor filter and take every row. Otherwise filter by the
        // supervisor column against the caller's allowSet.
        const matchedRows = sheetInfo.defaultSupervisor
          ? sheet.rows.filter(() =>
              allowSet.has(sheetInfo.defaultSupervisor!.trim().toLowerCase())
            )
          : sheet.rows.filter((r) => {
              const rec = rowToRecord(r, colsById);
              const v = s(rec[sheetInfo.supervisorKey]) ?? "";
              return allowSet.has(v.trim().toLowerCase());
            });

        for (const row of matchedRows) {
          const job = normalizeRow(row, colsById, sheetInfo.isZiply);
          if (job) {
            // Stamp the supervisor for pre-filtered reports so downstream UI
            // filters (by supervisor) can find these jobs.
            if (sheetInfo.defaultSupervisor && !job.constructionSupervisor) {
              job.constructionSupervisor = sheetInfo.defaultSupervisor;
            }
            filteredJobs.push(job);
          }
        }
      } catch (err) {
        console.error(`[jobsSync] Error syncing sheet ${sheetInfo.id}:`, err);
      }
    }

    // Load all existing jobs once so we can:
    //   - keep firstSyncedAt
    //   - reuse cached geocode when sourceAddress unchanged
    //   - detect which previously-tracked jobs are now off-tracker
    const existingSnap = await firestore.collection("jobs").get();
    const existingJobs = new Map<string, Job>();
    existingSnap.forEach((doc) => {
      existingJobs.set(doc.id, doc.data() as Job);
    });

    // Build set of jobIds present in this sync.
    const currentJobIds = new Set<string>();
    let upserted = 0;
    let geocodedFresh = 0;
    let geocodedCached = 0;
    let geocodeFailed = 0;

    // Process sequentially to keep geocode calls bounded
    let batch = firestore.batch();
    let batchCount = 0;

    for (const job of filteredJobs) {
      currentJobIds.add(job.jobId);

      const prior = existingJobs.get(job.jobId);
      if (prior) {
        job.firstSyncedAt = prior.firstSyncedAt;
      }

      // Geocode resolution.
      const sourceAddr = buildAddressString({
        address: job.address,
        city: job.city,
        zipCode: job.zipCode,
      });
      if (!sourceAddr) {
        // No address to geocode.
        job.geocode = prior?.geocode ?? null;
      } else if (
        prior?.geocode &&
        prior.geocode.sourceAddress === sourceAddr &&
        prior.geocode.status === "OK"
      ) {
        // Cache hit — reuse the prior geocode.
        job.geocode = prior.geocode;
        geocodedCached++;
      } else {
        // Fresh geocode.
        const g: JobGeocode = await geocodeAddress(sourceAddr);
        job.geocode = g;
        if (g.status === "OK") geocodedFresh++;
        else geocodeFailed++;
      }

      const docRef = firestore.collection("jobs").doc(job.jobId);
      batch.set(docRef, stripUndefined(job as unknown as Record<string, unknown>), {
        merge: true,
      });
      upserted++;
      batchCount++;

      if (batchCount >= 400) {
        await batch.commit();
        batch = firestore.batch();
        batchCount = 0;
      }
    }

    // Flag jobs that were previously on-tracker but are no longer in the sheet.
    // Scope to the supervisors being synced — don't touch other supervisors'
    // jobs (e.g. syncing Joe must not flag Billy's jobs off-tracker).
    let flaggedOffTracker = 0;
    for (const [jobId, prior] of existingJobs.entries()) {
      const priorSup = (prior.constructionSupervisor ?? "").trim().toLowerCase();
      if (!allowSet.has(priorSup)) continue;
      if (!currentJobIds.has(jobId) && prior.inTracker !== false) {
        const docRef = firestore.collection("jobs").doc(jobId);
        batch.update(docRef, {
          inTracker: false,
          lastSyncedAt: Date.now(),
        });
        flaggedOffTracker++;
        batchCount++;

        if (batchCount >= 400) {
          await batch.commit();
          batch = firestore.batch();
          batchCount = 0;
        }
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    const finished: SyncRun = {
      ...initial,
      finishedAt: Date.now(),
      status: "success",
      sheetTotalRows: totalRowCount,
      filteredRows: filteredJobs.length,
      upserted,
      flaggedOffTracker,
      geocodedFresh,
      geocodedCached,
      geocodeFailed,
    };
    await runDoc.set(finished);
    // Sync wrote to Firestore — next /api/jobs call must read fresh data.
    invalidateJobsCache();
    return finished;
  } catch (err) {
    const errored: SyncRun = {
      ...initial,
      finishedAt: Date.now(),
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
    await runDoc.set(errored, { merge: true });
    throw err;
  }
}
