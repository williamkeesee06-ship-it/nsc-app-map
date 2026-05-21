// Smartsheet -> Firestore sync.
// Filters to Construction Supervisor == Billy Keesee (configurable via env).
// Once a job is synced, it stays in Firestore even if it later leaves the
// tracker; we just flip inTracker to false.

import { db } from "../lib/firestore.js";
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
  colsById: Map<number, SmartsheetColumn>
): Job | null {
  const rec = rowToRecord(row, colsById);
  const workOrder = s(rec["Work Order"]);
  if (!workOrder) return null; // skip rows without a WO

  const workType = s(rec["Work Type"]);
  const now = Date.now();
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
  const supervisor = env.SYNC_SUPERVISOR;
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
    const sheet = await getSheet();
    const colsById = buildColumnsById(sheet);
    const filtered = sheet.rows.filter((r) => {
      const rec = rowToRecord(r, colsById);
      return s(rec["Construction Supervisor"]) === supervisor;
    });

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

    // Smartsheet returns rows in order; process sequentially to keep geocode
    // calls bounded (~5 req/sec is safe under Google's 50 QPS default).
    for (const row of filtered) {
      const job = normalizeRow(row, colsById);
      if (!job) continue;
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

      await firestore
        .collection("jobs")
        .doc(job.jobId)
        .set(stripUndefined(job as unknown as Record<string, unknown>), {
          merge: true,
        });
      upserted++;
    }

    // Flag jobs that were previously on-tracker but are no longer in the sheet.
    let flaggedOffTracker = 0;
    for (const [jobId, prior] of existingJobs.entries()) {
      if (!currentJobIds.has(jobId) && prior.inTracker !== false) {
        await firestore.collection("jobs").doc(jobId).update({
          inTracker: false,
          lastSyncedAt: Date.now(),
        });
        flaggedOffTracker++;
      }
    }

    const finished: SyncRun = {
      ...initial,
      finishedAt: Date.now(),
      status: "success",
      sheetTotalRows: sheet.totalRowCount,
      filteredRows: filtered.length,
      upserted,
      flaggedOffTracker,
      geocodedFresh,
      geocodedCached,
      geocodeFailed,
    };
    await runDoc.set(finished);
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
