// Sync routes: Smartsheet inspect + sync trigger + status read.
import { Router } from "express";
import {
  getSheet,
  buildColumnsById,
  rowToRecord,
} from "../lib/smartsheet.js";
import { runJobsSync, runJobsSyncForSupervisors, workOrderToJobId } from "../services/jobsSync.js";
import { db } from "../lib/firestore.js";
import { getEnv } from "../config/env.js";
import type { SyncRun } from "@nsc/types";

const router = Router();

// POST /api/sync/jobs — manual sync trigger.
// NOTE: Vercel serverless functions have a default timeout; for 191 rows with
// cached geocodes this completes in seconds. Cold-sync of all-new jobs may need
// a longer timeout — see vercel.json (functions.api/index.ts.maxDuration).
router.post("/sync/jobs", async (_req, res, next) => {
  try {
    const result = await runJobsSync();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/sync/supervisor
// Body: { supervisor: string }
// Phase 9.7: on-demand sync of a single supervisor's rows, called by the login
// flow so we only refresh data for supervisors who actually use the app.
// Verifies the supplied name is in the SYNC_SUPERVISORS allowlist before
// syncing — prevents arbitrary names from forcing a sync.
router.post("/sync/supervisor", async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { supervisor?: unknown };
    const supervisor = typeof body.supervisor === "string" ? body.supervisor.trim() : "";
    if (!supervisor) {
      res.status(400).json({ error: "supervisor is required" });
      return;
    }
    const env = getEnv();
    const allowlist = (env.SYNC_SUPERVISORS || env.SYNC_SUPERVISOR)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const match = allowlist.find(
      (s) => s.toLowerCase() === supervisor.toLowerCase()
    );
    if (!match) {
      res.status(403).json({ error: "supervisor not in allowlist" });
      return;
    }
    const result = await runJobsSyncForSupervisors([match]);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/sync/all-supervisors
// Body: { manager: string }
// Phase 9.7: manager-mode sync — pulls jobs for EVERY supervisor in the
// allowlist. Used by Robbie Thoman (and any future manager) so he can see
// every supervisor's jobs on the map. Verifies the caller is in the managers
// list before running the (more expensive) full sync.
router.post("/sync/all-supervisors", async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { manager?: unknown };
    const manager = typeof body.manager === "string" ? body.manager.trim() : "";
    if (!manager) {
      res.status(400).json({ error: "manager is required" });
      return;
    }
    const env = getEnv();
    const managers = (env.SYNC_MANAGERS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const isManager = managers.some(
      (m) => m.toLowerCase() === manager.toLowerCase()
    );
    if (!isManager) {
      res.status(403).json({ error: "caller is not a manager" });
      return;
    }
    const allowlist = (env.SYNC_SUPERVISORS || env.SYNC_SUPERVISOR)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const result = await runJobsSyncForSupervisors(allowlist);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/sync/status — most recent sync run.
router.get("/sync/status", async (_req, res, next) => {
  try {
    const snap = await db()
      .collection("syncRuns")
      .orderBy("startedAt", "desc")
      .limit(1)
      .get();
    if (snap.empty) {
      res.json({ lastRun: null });
      return;
    }
    const lastRun = snap.docs[0]!.data() as SyncRun;
    res.json({ lastRun });
  } catch (err: any) {
    if (err && err.message && err.message.includes("RESOURCE_EXHAUSTED")) {
      // Gracefully handle Firestore daily quota exhaustion
      res.json({
        lastRun: {
          syncId: "quota-exceeded",
          startedAt: Date.now(),
          finishedAt: Date.now(),
          status: "error",
          sheetTotalRows: 0,
          filteredRows: 0,
          upserted: 0,
          flaggedOffTracker: 0,
          geocodedFresh: 0,
          geocodedCached: 0,
          geocodeFailed: 0,
          error: "Firebase daily read quota exhausted (50,000 reads). Will reset at midnight PT.",
        } as SyncRun,
      });
      return;
    }
    next(err);
  }
});

// GET /api/sync/inspect
// Diagnostic: returns sheet name, totalRowCount, column list, and a sample of
// the first 3 rows as {columnTitle: displayValue} records. Used during Phase 2
// build to discover real column names before writing the normalizer.
router.get("/sync/inspect", async (req, res, next) => {
  try {
    const sheet = await getSheet();
    const colsById = buildColumnsById(sheet);
    const sampleRows = sheet.rows.slice(0, 3).map((r) => ({
      id: r.id,
      rowNumber: r.rowNumber,
      values: rowToRecord(r, colsById),
    }));

    // Count Billy Keesee's rows + collect distinct Job Status / Work Type values for him.
    const supervisorFilter = String(
      (req.query.supervisor as string | undefined) ?? "Billy Keesee"
    );
    const allRecords = sheet.rows.map((r) => rowToRecord(r, colsById));
    const filtered = allRecords.filter(
      (r) => String(r["Construction Supervisor"] ?? "") === supervisorFilter
    );
    const distinctJobStatus = Array.from(
      new Set(filtered.map((r) => String(r["Job Status"] ?? "")).filter(Boolean))
    );
    const distinctWorkType = Array.from(
      new Set(filtered.map((r) => String(r["Work Type"] ?? "")).filter(Boolean))
    );
    const distinctConstructionBase = Array.from(
      new Set(
        filtered.map((r) => String(r["Construction Base"] ?? "")).filter(Boolean)
      )
    );
    const sampleFiltered = filtered.slice(0, 2).map((r) => ({
      WorkOrder: r["Work Order"],
      JobStatus: r["Job Status"],
      SecondaryJobStatus: r["Secondary Job Status"],
      WorkType: r["Work Type"],
      ConstructionBase: r["Construction Base"],
      Address: r["Address"],
      City: r["City"],
      ZipCode: r["Zip Code"],
      Customer: r["Customer/Project"] ?? r["Customer / Project"],
    }));

    res.json({
      sheetId: sheet.id,
      sheetName: sheet.name,
      totalRowCount: sheet.totalRowCount,
      columns: sheet.columns.map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        index: c.index,
        options: c.options,
      })),
      sampleRows,
      supervisorFilter,
      filteredRowCount: filtered.length,
      distinctJobStatus,
      distinctWorkType,
      distinctConstructionBase,
      sampleFiltered,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/sync/admin?key=<SYNC_ADMIN_KEY>
// Public admin trigger guarded by a shared secret. Runs the full multi-
// supervisor sync (equivalent to a manager clicking "Resync now"). Used by
// operators / crons that don't have a Firebase login. Only enabled when
// SYNC_ADMIN_KEY is set in the environment.
// Note: registered as both POST (explicit) and GET (Vercel cron uses GET) so
// the same handler can be called by the cron and by ad-hoc curl invocations.
const syncAdminHandler: import("express").RequestHandler = async (req, res, next) => {
  try {
    const env = getEnv();
    const configuredKey = (env.SYNC_ADMIN_KEY ?? "").trim();
    if (!configuredKey) {
      res.status(503).json({
        error:
          "Admin sync disabled. Set SYNC_ADMIN_KEY in the Vercel environment to enable.",
      });
      return;
    }
    // Accept the key via ?key= (curl / ad-hoc), request body (JSON POST), or
    // Authorization: Bearer <key> (Vercel cron sends this header).
    const bearer =
      req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
    const providedKey = String(
      req.query.key ?? (req.body as { key?: unknown })?.key ?? bearer
    ).trim();
    if (providedKey !== configuredKey) {
      res.status(403).json({ error: "Invalid admin key" });
      return;
    }

    const allowlist = (env.SYNC_SUPERVISORS || env.SYNC_SUPERVISOR)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const result = await runJobsSyncForSupervisors(allowlist);
    res.json(result);
  } catch (err) {
    next(err);
  }
};
router.post("/sync/admin", syncAdminHandler);
router.get("/sync/admin", syncAdminHandler);

// POST /api/sync/reconcile-tracker?key=<SYNC_ADMIN_KEY>&reportId=<id>[&dryRun=true][&customerProject=Ziply]
//
// One-shot reconciliation: treat the given Smartsheet report as the SOURCE OF
// TRUTH for which jobs are "in tracker." Any Firestore job matching the scope
// (default: customerProject === "Ziply") whose jobId is NOT in the report gets
// flipped to inTracker:false. Jobs already inTracker:false are left alone.
//
// This exists because the per-supervisor sheet sync can't detect rows removed
// from Billy's rolled-up tracker report — removals in the report don't
// propagate to the underlying supervisor sheets, so runJobsSyncForSupervisors
// never sees them as "gone." This endpoint closes that gap on demand.
//
// Query params:
//   key             — SYNC_ADMIN_KEY (required)
//   reportId        — numeric Smartsheet report ID (defaults to env.ZIPLY_TRACKER_REPORT_ID)
//   dryRun=true     — return the diff without writing
//   customerProject — Firestore scope filter (default: "Ziply")
const reconcileTrackerHandler: import("express").RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const env = getEnv();
    const configuredKey = (env.SYNC_ADMIN_KEY ?? "").trim();
    if (!configuredKey) {
      res.status(503).json({ error: "Admin sync disabled." });
      return;
    }
    const bearer =
      req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
    const providedKey = String(
      req.query.key ?? (req.body as { key?: unknown })?.key ?? bearer
    ).trim();
    if (providedKey !== configuredKey) {
      res.status(403).json({ error: "Invalid admin key" });
      return;
    }

    const reportId = String(
      req.query.reportId ?? env.ZIPLY_TRACKER_REPORT_ID ?? ""
    ).trim();
    if (!reportId) {
      res.status(400).json({
        error:
          "reportId required (query ?reportId=... or env ZIPLY_TRACKER_REPORT_ID)",
      });
      return;
    }
    const dryRun = String(req.query.dryRun ?? "").toLowerCase() === "true";
    const scopeProject = String(req.query.customerProject ?? "Ziply").trim();

    // 1. Fetch the report and build the authoritative set of jobIds.
    const report = await getSheet({}, reportId);
    const colsById = buildColumnsById(report);
    // Smartsheet convention: the Primary column is always at index 0. The
    // SmartsheetColumn type doesn't expose a `primary` flag, so we detect it
    // positionally and fall back to a title-based match for safety.
    const primaryCol =
      report.columns.find((c) => c.index === 0) ??
      report.columns.find((c) => c.title === "Primary") ??
      report.columns.find((c) => c.title === "Work Order");
    const primaryTitle = primaryCol?.title ?? "Primary";

    const inReport = new Set<string>();
    const reportPrimaryValues: string[] = [];
    for (const row of report.rows) {
      const rec = rowToRecord(row, colsById);
      // Prefer the explicit primary column; fall back to "Work Order" then
      // "Primary" so this is resilient to report column-title tweaks.
      const raw =
        (rec[primaryTitle] as string | undefined) ??
        (rec["Work Order"] as string | undefined) ??
        (rec["Primary"] as string | undefined);
      const wo = raw == null ? null : String(raw).trim();
      if (!wo) continue;
      reportPrimaryValues.push(wo);
      inReport.add(workOrderToJobId(wo));
    }

    // 2. Query Firestore for in-scope jobs currently marked in-tracker.
    const firestore = db();
    // Firestore doesn't index inTracker:!== false directly; pull all
    // customerProject rows and filter in memory (Ziply set is small).
    const snap = await firestore
      .collection("jobs")
      .where("customerProject", "==", scopeProject)
      .get();

    const toFlipOff: Array<{ jobId: string; workOrder: string }> = [];
    const alreadyOff: string[] = [];
    let onTrackerCount = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as {
        jobId: string;
        workOrder: string;
        inTracker?: boolean;
      };
      if (data.inTracker === false) {
        alreadyOff.push(data.jobId);
        continue;
      }
      onTrackerCount++;
      if (!inReport.has(data.jobId)) {
        toFlipOff.push({ jobId: data.jobId, workOrder: data.workOrder });
      }
    }

    // 3. Write the flip (unless dry-run).
    let written = 0;
    if (!dryRun && toFlipOff.length > 0) {
      let batch = firestore.batch();
      let batchCount = 0;
      const now = Date.now();
      for (const { jobId } of toFlipOff) {
        batch.update(firestore.collection("jobs").doc(jobId), {
          inTracker: false,
          lastSyncedAt: now,
        });
        batchCount++;
        written++;
        if (batchCount >= 400) {
          await batch.commit();
          batch = firestore.batch();
          batchCount = 0;
        }
      }
      if (batchCount > 0) await batch.commit();
    }

    res.json({
      reportId,
      reportName: report.name,
      reportKind: report.kind,
      primaryColumn: primaryTitle,
      reportRowCount: report.rows.length,
      reportUniqueJobIds: inReport.size,
      firestoreScopeProject: scopeProject,
      firestoreScopeCount: snap.size,
      firestoreOnTrackerBefore: onTrackerCount,
      firestoreAlreadyOffTracker: alreadyOff.length,
      wouldFlipOff: toFlipOff.length,
      flippedOff: written,
      dryRun,
      // Small sample so operators can eyeball what's happening.
      sampleReportPrimary: reportPrimaryValues.slice(0, 5),
      sampleFlipOff: toFlipOff.slice(0, 10),
    });
  } catch (err) {
    next(err);
  }
};
router.post("/sync/reconcile-tracker", reconcileTrackerHandler);
router.get("/sync/reconcile-tracker", reconcileTrackerHandler);

// GET /api/sync/diag — TEMP diagnostic (public, no auth). Reports last sync
// run + hits the Ziply report directly and returns row count, column names,
// and the distinct supervisor values found. Used to debug why the Ziply sync
// isn't returning the expected 358 jobs. Remove once verified.
router.get("/sync/diag", async (_req, res, next) => {
  try {
    const env = getEnv();
    const out: Record<string, unknown> = {
      ts: new Date().toISOString(),
      env: {
        hasSmartsheetToken: Boolean(env.SMARTSHEET_API_TOKEN),
        lumenSheetId: env.SMARTSHEET_SHEET_ID,
        ziplySheetId: env.ZIPLY_SMARTSHEET_SHEET_ID ?? null,
        syncSupervisors: env.SYNC_SUPERVISORS,
      },
    };

    // Last sync run
    try {
      const snap = await db()
        .collection("syncRuns")
        .orderBy("startedAt", "desc")
        .limit(3)
        .get();
      out.lastSyncRuns = snap.docs.map((d) => d.data());
    } catch (e: any) {
      out.lastSyncRunsError = String(e?.message ?? e);
    }

    // Try Ziply report directly
    const ziplyId = env.ZIPLY_SMARTSHEET_SHEET_ID;
    if (ziplyId) {
      try {
        const sheet = await getSheet({}, ziplyId);
        const colsById = buildColumnsById(sheet);
        const records = sheet.rows.map((r) => rowToRecord(r, colsById));
        const supervisorCounts: Record<string, number> = {};
        const jobStatusCounts: Record<string, number> = {};
        for (const rec of records) {
          const sup = String(
            rec["NSC Supervisor"] ?? rec["Construction Supervisor"] ?? "(blank)"
          );
          supervisorCounts[sup] = (supervisorCounts[sup] ?? 0) + 1;
          const st = String(rec["Job Status"] ?? "(blank)");
          jobStatusCounts[st] = (jobStatusCounts[st] ?? 0) + 1;
        }
        out.ziply = {
          kind: (sheet as any).kind,
          sheetId: sheet.id,
          sheetName: sheet.name,
          totalRowCount: sheet.totalRowCount,
          fetchedRowCount: sheet.rows.length,
          columnTitles: sheet.columns.map((c) => c.title),
          supervisorCounts,
          jobStatusCounts,
          sampleRow: records[0] ?? null,
        };
      } catch (e: any) {
        out.ziplyError = {
          message: String(e?.message ?? e),
          stack: String(e?.stack ?? "").split("\n").slice(0, 5),
        };
      }
    }

    res.json(out);
  } catch (err) {
    next(err);
  }
});

// POST /api/sync/purge-print-overlay-docs?key=<SYNC_ADMIN_KEY>
// Body: { jobId: string, keepDocumentIds: string[] }
//
// Wipes every page/transform/alignment/source on the job's printOverlay
// whose documentId is NOT in keepDocumentIds. Used to clean up orphan
// prints that accumulated on a job over multiple upload sessions.
// Guarded by SYNC_ADMIN_KEY. Registered in isPublicApiPath so it skips
// the Firebase auth gate — the shared secret is the auth boundary.
const purgePrintOverlayDocsHandler: import("express").RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const env = getEnv();
    const configuredKey = (env.SYNC_ADMIN_KEY ?? "").trim();
    if (!configuredKey) {
      res.status(503).json({ error: "Admin sync disabled (no SYNC_ADMIN_KEY)." });
      return;
    }
    const bearer =
      req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
    const providedKey = String(
      req.query.key ?? (req.body as { key?: unknown })?.key ?? bearer
    ).trim();
    if (providedKey !== configuredKey) {
      res.status(403).json({ error: "Invalid admin key" });
      return;
    }

    const body = (req.body ?? {}) as {
      jobId?: unknown;
      keepDocumentIds?: unknown;
      removeDocumentIds?: unknown;
    };
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    if (!jobId) {
      res.status(400).json({ error: "Missing jobId" });
      return;
    }
    const hasKeep = Array.isArray(body.keepDocumentIds);
    const hasRemove = Array.isArray(body.removeDocumentIds);
    if (!hasKeep && !hasRemove) {
      res
        .status(400)
        .json({ error: "Provide keepDocumentIds or removeDocumentIds" });
      return;
    }
    const keepIdsInput = hasKeep
      ? new Set<string>(
          (body.keepDocumentIds as unknown[])
            .filter((v): v is string => typeof v === "string")
            .map((s) => s.trim())
            .filter(Boolean)
        )
      : null;
    const removeIds = new Set<string>(
      hasRemove
        ? (body.removeDocumentIds as unknown[])
            .filter((v): v is string => typeof v === "string")
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    );

    const ref = db().collection("jobs").doc(jobId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: `Job ${jobId} not found` });
      return;
    }
    const data = snap.data() as {
      printOverlay?: {
        sources?: Array<{ documentId?: string }>;
        pages?: Array<{ id?: string; documentId?: string }>;
        transforms?: Record<string, unknown>;
        alignments?: Record<string, unknown>;
      } | null;
    };
    const po = data.printOverlay;
    if (!po) {
      res.json({ jobId, printOverlay: null, removed: null });
      return;
    }

    const oldSources = Array.isArray(po.sources) ? po.sources : [];
    const oldPages = Array.isArray(po.pages) ? po.pages : [];
    const oldTransforms = (po.transforms ?? {}) as Record<string, unknown>;
    const oldAlignments = (po.alignments ?? {}) as Record<string, unknown>;

    const shouldKeep = (docId: unknown): boolean => {
      if (typeof docId !== "string") return false;
      if (keepIdsInput) return keepIdsInput.has(docId);
      return !removeIds.has(docId);
    };
    const keptSources = oldSources.filter((s) => shouldKeep(s.documentId));
    const keptPages = oldPages.filter((p) => shouldKeep(p.documentId));
    const keptPageIds = new Set(
      keptPages
        .map((p) => (typeof p.id === "string" ? p.id : null))
        .filter((v): v is string => Boolean(v))
    );
    const keptTransforms: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(oldTransforms)) {
      if (keptPageIds.has(k)) keptTransforms[k] = v;
    }
    const keptAlignments: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(oldAlignments)) {
      if (keptPageIds.has(k)) keptAlignments[k] = v;
    }

    const nextPO = {
      ...po,
      sources: keptSources,
      pages: keptPages,
      transforms: keptTransforms,
      alignments: keptAlignments,
    };

    await ref.update({ printOverlay: nextPO });

    res.json({
      jobId,
      mode: hasKeep ? "keep" : "remove",
      keepDocumentIds: keepIdsInput ? Array.from(keepIdsInput) : null,
      removeDocumentIds: hasRemove ? Array.from(removeIds) : null,
      removed: {
        sources: oldSources.length - keptSources.length,
        pages: oldPages.length - keptPages.length,
        transforms:
          Object.keys(oldTransforms).length - Object.keys(keptTransforms).length,
        alignments:
          Object.keys(oldAlignments).length - Object.keys(keptAlignments).length,
      },
      kept: {
        sources: keptSources.length,
        pages: keptPages.length,
        transforms: Object.keys(keptTransforms).length,
        alignments: Object.keys(keptAlignments).length,
      },
    });
  } catch (err) {
    next(err);
  }
};
router.post("/sync/purge-print-overlay-docs", purgePrintOverlayDocsHandler);
router.get("/sync/purge-print-overlay-docs", purgePrintOverlayDocsHandler);

export default router;
