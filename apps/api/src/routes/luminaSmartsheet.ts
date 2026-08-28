/**
 * Lumina Smartsheet read-only access — scoped to Billy Keesee.
 *
 * Three endpoints:
 *
 *   GET  /api/lumina/smartsheet/rows?q=&limit=&fields=
 *        List rows where "Construction Supervisor" === SUPERVISOR_SCOPE.
 *        Optional `q` does a case-insensitive substring match across the
 *        lean projection. Optional `fields` is a comma-separated whitelist
 *        of extra column titles to include beyond the default projection.
 *
 *   GET  /api/lumina/smartsheet/rows/:rowId
 *        Full row by Smartsheet row id (every column).
 *
 *   GET  /api/lumina/smartsheet/by-job/:workOrder
 *        Lookup by Work Order # (Billy's most common path).
 *
 * Why scoping is enforced server-side:
 *   - The browser tool can't be trusted to filter; if a future bug or model
 *     prompt drift sends "list ALL rows", the server still hides everything
 *     outside Billy's scope. Single choke point, single rule.
 *
 * Why getSheet() with no pagination:
 *   - Smartsheet's sheet API tops out around 5000 rows per page and our
 *     Operations Tracker holds ~500 rows. `includeAll=true` already pulls
 *     everything in one call.
 *   - We cache the response in-memory for SHEET_TTL_MS so a chat session
 *     that fires three Smartsheet tools in a row only hits Smartsheet once.
 */

import { Router, type Request, type Response } from "express";
import {
  getSheet,
  buildColumnsById,
  rowToRecord,
  updateRowCells,
  findRowByWorkOrder,
  type SmartsheetSheet,
  type SmartsheetRow,
} from "../lib/smartsheet.js";

// Map of supervisor name -> hex color, matching the Lumen Calendar legend.
// Lives here so both the calendar endpoint and any future tools use one source of truth.
const SUPERVISOR_COLORS: Record<string, string> = {
  "Billy Keesee":    "#39ff14", // bright green (mine)
  "Joe Watson":      "#2a2a2a",
  "Jamey Beckwith":  "#ff1493",
  "Mike Smith":      "#ff3333",
  "Jason Lynch":     "#d8d8d0",
  "Dustin Halbert":  "#8a6a14",
  "Robbie Thoman":   "#dcdcdc",
  "Jarrod Anderson": "#3aa1ff",
  "Rob Dautrich":    "#0040b0",
  "Shawn Heenan":    "#ff66cc",
  "Tristan Thoman":  "#e8e8e8",
  "RJ Tudela":       "#ff8c2a",
  "Scott Roberge":   "#1f7f8a",
  "Taylor Scott":    "#e6ff00",
  "Matt Crise":      "#8b3a4f",
  "Mike Thoman":     "#7a3f5f",
};

const router = Router();

// Hard-coded so the model can't override the scope at runtime. If we ever
// want to allow managers to read other supervisors' rows, that's a separate
// tool with its own auth check — not a query param on this one.
const SUPERVISOR_SCOPE = "Billy Keesee";
const SUPERVISOR_COLUMN = "Construction Supervisor";

// Default lean projection — the model rarely needs every column to answer
// a question, and shrinking the payload keeps Gemini's response budget
// from being eaten by row data.
const DEFAULT_PROJECTION = [
  "Work Order",
  "Job Status",
  "Secondary Job Status",
  "Address",
  "City",
  "Schedule Date",
  "Construction Crew/Forman", // sic — sheet column actually misspelled
  "Work Type",
  "NSC Project Notes",
  "Modified",
] as const;

// ----- Caching ------------------------------------------------------------

// In-memory cache so chained Smartsheet tools in one chat turn don't pay
// the full sheet round-trip every time. 60s is short enough that any edit
// Billy makes in the Smartsheet UI shows up almost-immediately on his next
// "and now check Smartsheet" question.
const SHEET_TTL_MS = 60_000;

// Two separate caches: a fast one without attachments (used by /rows, /by-job,
// and Lumina tools) and a heavier one with attachments (only fetched when the
// Calendar tab opens — attachments roughly double the response payload).
let cachedSheet: { at: number; sheet: SmartsheetSheet } | null = null;
let cachedSheetWithAtt: { at: number; sheet: SmartsheetSheet } | null = null;

async function getSheetCached(): Promise<SmartsheetSheet> {
  const now = Date.now();
  if (cachedSheet && now - cachedSheet.at < SHEET_TTL_MS) {
    return cachedSheet.sheet;
  }
  const sheet = await getSheet();
  cachedSheet = { at: now, sheet };
  return sheet;
}

async function getSheetWithAttachmentsCached(): Promise<SmartsheetSheet> {
  const now = Date.now();
  if (cachedSheetWithAtt && now - cachedSheetWithAtt.at < SHEET_TTL_MS) {
    return cachedSheetWithAtt.sheet;
  }
  const sheet = await getSheet({ withAttachments: true });
  cachedSheetWithAtt = { at: now, sheet };
  return sheet;
}

// ----- Helpers ------------------------------------------------------------

function projectRow(
  rec: Record<string, string | number | boolean | null>,
  extraFields: string[]
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const col of DEFAULT_PROJECTION) {
    if (col in rec) out[col] = rec[col];
  }
  for (const col of extraFields) {
    if (col in rec) out[col] = rec[col];
  }
  return out;
}

function matchesQuery(
  projected: Record<string, string | number | boolean | null>,
  q: string
): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  for (const v of Object.values(projected)) {
    if (v == null) continue;
    if (String(v).toLowerCase().includes(needle)) return true;
  }
  return false;
}

// ----- GET /lumina/smartsheet/rows ---------------------------------------

router.get("/lumina/smartsheet/rows", async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "25"), 10) || 25, 1), 200);
  const fieldsParam = String(req.query.fields ?? "").trim();
  const extraFields = fieldsParam
    ? fieldsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  try {
    const sheet = await getSheetCached();
    const columnsById = buildColumnsById(sheet);

    const matched: Array<{
      rowId: number;
      rowNumber: number;
      modifiedAt?: string;
      fields: Record<string, string | number | boolean | null>;
    }> = [];

    for (const row of sheet.rows) {
      const rec = rowToRecord(row, columnsById);
      const sup = String(rec[SUPERVISOR_COLUMN] ?? "").trim();
      if (sup !== SUPERVISOR_SCOPE) continue;
      const projected = projectRow(rec, extraFields);
      if (!matchesQuery(projected, q)) continue;
      matched.push({
        rowId: row.id,
        rowNumber: row.rowNumber,
        modifiedAt: row.modifiedAt,
        fields: projected,
      });
      if (matched.length >= limit) break;
    }

    res.json({
      scope: SUPERVISOR_SCOPE,
      totalReturned: matched.length,
      sheetName: sheet.name,
      sheetId: String(sheet.id),
      cachedSeconds: cachedSheet ? Math.round((Date.now() - cachedSheet.at) / 1000) : 0,
      rows: matched,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/smartsheet/rows] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ----- GET /lumina/smartsheet/rows/:rowId --------------------------------

router.get("/lumina/smartsheet/rows/:rowId", async (req: Request, res: Response) => {
  const rowId = parseInt(req.params.rowId, 10);
  if (Number.isNaN(rowId) || rowId <= 0) {
    return res.status(400).json({ error: "valid rowId required" });
  }
  try {
    const sheet = await getSheetCached();
    const columnsById = buildColumnsById(sheet);
    const row = sheet.rows.find((r) => r.id === rowId);
    if (!row) {
      return res.status(404).json({ error: `Row ${rowId} not found in sheet.` });
    }
    const rec = rowToRecord(row, columnsById);
    const sup = String(rec[SUPERVISOR_COLUMN] ?? "").trim();
    if (sup !== SUPERVISOR_SCOPE) {
      // Don't leak existence of out-of-scope rows.
      return res.status(404).json({ error: `Row ${rowId} not found in sheet.` });
    }
    res.json({
      rowId: row.id,
      rowNumber: row.rowNumber,
      modifiedAt: row.modifiedAt,
      fields: rec,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/smartsheet/rows/:rowId] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ----- GET /lumina/smartsheet/by-job/:workOrder --------------------------

router.get("/lumina/smartsheet/by-job/:workOrder", async (req: Request, res: Response) => {
  const wo = String(req.params.workOrder ?? "").trim();
  if (!wo) return res.status(400).json({ error: "workOrder required" });
  try {
    const sheet = await getSheetCached();
    const columnsById = buildColumnsById(sheet);
    // Normalize both sides: strip whitespace, compare case-insensitively, also
    // accept variations like "WO 4521" vs "4521" vs "#4521".
    const needle = wo.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const matches: Array<{
      rowId: number;
      rowNumber: number;
      modifiedAt?: string;
      fields: Record<string, string | number | boolean | null>;
    }> = [];
    for (const row of sheet.rows) {
      const rec = rowToRecord(row, columnsById);
      const sup = String(rec[SUPERVISOR_COLUMN] ?? "").trim();
      if (sup !== SUPERVISOR_SCOPE) continue;
      const woRaw = String(rec["Work Order"] ?? "");
      const woNorm = woRaw.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (woNorm === needle || woNorm.includes(needle)) {
        matches.push({
          rowId: row.id,
          rowNumber: row.rowNumber,
          modifiedAt: row.modifiedAt,
          fields: rec, // full record on by-job — the model usually wants everything
        });
      }
    }
    if (matches.length === 0) {
      return res.json({
        scope: SUPERVISOR_SCOPE,
        workOrder: wo,
        totalReturned: 0,
        rows: [],
        zeroMatchHint:
          "No rows in Billy's scope for that Work Order. If this job belongs to another supervisor, it won't be visible.",
      });
    }
    res.json({
      scope: SUPERVISOR_SCOPE,
      workOrder: wo,
      totalReturned: matches.length,
      rows: matches,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/smartsheet/by-job] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ----- GET /lumina/smartsheet/locate/:workOrder --------------------------
//
// Sheet-wide existence check. Unlike /by-job (Billy-scoped), this looks
// at EVERY row in the tracker and reports only:
//   - whether the work order exists somewhere on the sheet
//   - which supervisor owns it (or null if no supervisor assigned yet)
//   - city + Job Status for context
// We deliberately do NOT return notes or arbitrary cells — Billy can read
// his own rows in full via /by-job, but the rest of the sheet stays opaque.
// This unblocks the "is this job routed somewhere else?" question without
// leaking sensitive cross-supervisor data.
router.get("/lumina/smartsheet/locate/:workOrder", async (req: Request, res: Response) => {
  const wo = String(req.params.workOrder ?? "").trim();
  if (!wo) return res.status(400).json({ error: "workOrder required" });
  try {
    const sheet = await getSheetCached();
    const columnsById = buildColumnsById(sheet);
    // Same normalization as /by-job so "P.362908", "362908", "#362908" all match.
    const needle = wo.replace(/[^a-z0-9]/gi, "").toLowerCase();

    interface LocateHit {
      rowId: number;
      workOrder: string;
      supervisor: string | null;
      isMine: boolean;
      city: string | null;
      jobStatus: string | null;
    }
    const hits: LocateHit[] = [];
    for (const row of sheet.rows) {
      const rec = rowToRecord(row, columnsById);
      const woRaw = String(rec["Work Order"] ?? "");
      const woNorm = woRaw.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (!woNorm) continue;
      if (woNorm !== needle && !woNorm.includes(needle)) continue;
      const sup = String(rec[SUPERVISOR_COLUMN] ?? "").trim();
      hits.push({
        rowId: row.id,
        workOrder: woRaw,
        supervisor: sup || null,
        isMine: sup === SUPERVISOR_SCOPE,
        city: (rec["City"] as string) ?? null,
        jobStatus: (rec["Job Status"] as string) ?? null,
      });
    }

    if (hits.length === 0) {
      return res.json({
        workOrder: wo,
        found: false,
        hits: [],
        message: "This work order is not on the Smartsheet tracker at all.",
      });
    }
    // Sort: Billy's rows first (in case of dupes), then the rest.
    hits.sort((a, b) => Number(b.isMine) - Number(a.isMine));
    res.json({
      workOrder: wo,
      found: true,
      hits,
      anyMine: hits.some((h) => h.isMine),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/smartsheet/locate] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ----- GET /lumina/smartsheet/calendar -----------------------------------
//
// Powers the Calendar tab in the web UI. Returns events for a 5-day work
// week (Mon-Fri) starting at `weekStart` (YYYY-MM-DD, Pacific time). Each
// event represents one project row whose [Schedule Date, End Date] interval
// overlaps that week.
//
// scope=mine (default) -> Billy Keesee only (matches the rest of this router).
// scope=all            -> every supervisor, used by the "All Supervisors"
//                         toggle in the calendar tab. We still only return
//                         the calendar-relevant projection — no NSC Project
//                         Notes or arbitrary cells.
//
// Why not derive `endOfWeek` server-side? Because the supervisor in the
// field might want to peek Sat/Sun jobs later, or the week-start day could
// change (some shops use Sun-anchored weeks). Letting the client choose the
// 5 ISO dates keeps the API future-proof.
router.get("/lumina/smartsheet/calendar", async (req: Request, res: Response) => {
  const weekStart = String(req.query.weekStart ?? "").trim();
  const scope = String(req.query.scope ?? "mine").trim().toLowerCase();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return res.status(400).json({ error: "weekStart=YYYY-MM-DD required (the Monday of the desired week)." });
  }
  if (scope !== "mine" && scope !== "all") {
    return res.status(400).json({ error: "scope must be 'mine' or 'all'." });
  }

  // Build the 5-day Mon-Fri window as JS Dates at UTC midnight.
  // We compare date-only (no timezone math) because Smartsheet's DATE column
  // emits an ISO yyyy-MM-dd string with no timezone — the row IS a date,
  // not an instant in time.
  const start = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: "weekStart did not parse as a date." });
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 4); // inclusive: Mon+4 = Fri

  try {
    const sheet = await getSheetWithAttachmentsCached();
    const columnsById = buildColumnsById(sheet);

    interface CalendarEvent {
      rowId: number;
      workOrder: string;
      jobStatus: string | null;
      supervisor: string;
      supervisorColor: string;
      crew: string;
      address: string;
      city: string;
      bidMaster: string | null;
      base: string | null;
      scheduleDate: string; // YYYY-MM-DD
      endDate: string;      // YYYY-MM-DD (== scheduleDate if single-day)
      attachmentCount: number;
      modifiedAt?: string;
    }

    const events: CalendarEvent[] = [];

    for (const row of sheet.rows) {
      const rec = rowToRecord(row, columnsById);
      const sup = String(rec[SUPERVISOR_COLUMN] ?? "").trim();
      if (!sup) continue;
      if (scope === "mine" && sup !== SUPERVISOR_SCOPE) continue;

      const sd = String(rec["Schedule Date"] ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}/.test(sd)) continue;
      const ed = String(rec["End Date"] ?? "").trim();
      const endIso = /^\d{4}-\d{2}-\d{2}/.test(ed) ? ed.slice(0, 10) : sd.slice(0, 10);
      const sdIso = sd.slice(0, 10);

      // Overlap test: event.start <= weekEnd && event.end >= weekStart
      const evStart = new Date(`${sdIso}T00:00:00Z`);
      const evEnd = new Date(`${endIso}T00:00:00Z`);
      if (evStart.getTime() > end.getTime()) continue;
      if (evEnd.getTime() < start.getTime()) continue;

      // Normalize crew names: some rows use a tab character ("Isaac\tSablan")
      // which would split into a separate row in the UI. Collapse whitespace.
      const crewRaw = String(rec["Construction Crew/Forman"] ?? "").trim();
      const crew = crewRaw.replace(/\s+/g, " ") || "(unassigned)";

      events.push({
        rowId: row.id,
        workOrder: String(rec["Work Order"] ?? "").trim(),
        jobStatus: rec["Job Status"] != null ? String(rec["Job Status"]) : null,
        supervisor: sup,
        supervisorColor: SUPERVISOR_COLORS[sup] ?? "#9aa4b2",
        crew,
        address: String(rec["Address"] ?? "").trim(),
        city: String(rec["City"] ?? "").trim(),
        bidMaster: rec["BidMaster Value"] != null ? String(rec["BidMaster Value"]) : null,
        base: rec["Construction Base"] != null ? String(rec["Construction Base"]) : null,
        scheduleDate: sdIso,
        endDate: endIso,
        attachmentCount: Array.isArray(row.attachments) ? row.attachments.length : 0,
        modifiedAt: row.modifiedAt,
      });
    }

    // Sort: by schedule date asc, then crew asc, then WO. Gives the UI a
    // deterministic order so multi-day bars layer predictably.
    events.sort((a, b) => {
      if (a.scheduleDate !== b.scheduleDate) return a.scheduleDate < b.scheduleDate ? -1 : 1;
      if (a.crew !== b.crew) return a.crew < b.crew ? -1 : 1;
      return a.workOrder.localeCompare(b.workOrder);
    });

    res.json({
      scope,
      supervisor: scope === "mine" ? SUPERVISOR_SCOPE : null,
      weekStart: weekStart,
      weekEnd: end.toISOString().slice(0, 10),
      totalEvents: events.length,
      supervisorColors: SUPERVISOR_COLORS,
      cachedSeconds: cachedSheetWithAtt
        ? Math.round((Date.now() - cachedSheetWithAtt.at) / 1000)
        : 0,
      events,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/smartsheet/calendar] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ----- Shared helper: resolve a job to a Smartsheet row + assert scope --
//
// Used by every write endpoint below. Lookup is by Work Order (case-insens.,
// trimmed) OR by numeric rowId. Returns the resolved row, the supervisor it
// belongs to, and the always-fresh sheet snapshot. Throws on miss so callers
// can let the express error path serialize.
async function resolveJobRow(
  jobIdOrRowId: string | number,
  expectedSupervisor: string
): Promise<{ row: SmartsheetRow; supervisor: string; sheet: SmartsheetSheet }> {
  // Force a fresh read — the write-then-immediately-re-read pattern is too
  // common to risk a 60s stale cache.
  const sheet = await getSheet();
  const byId = buildColumnsById(sheet);

  let row: SmartsheetRow | undefined;
  const numeric = typeof jobIdOrRowId === "number" ? jobIdOrRowId : Number(jobIdOrRowId);
  if (Number.isFinite(numeric) && String(numeric) === String(jobIdOrRowId)) {
    row = sheet.rows.find((r) => r.id === numeric);
  } else {
    const found = findRowByWorkOrder(sheet, String(jobIdOrRowId));
    row = found ?? undefined;
  }
  if (!row) {
    throw Object.assign(new Error(`Job "${jobIdOrRowId}" not found in Smartsheet.`), { status: 404 });
  }

  const rec = rowToRecord(row, byId);
  const supervisor = String(rec[SUPERVISOR_COLUMN] ?? "").trim();
  if (!supervisor) {
    throw Object.assign(new Error(`Row ${row.id} has no Construction Supervisor set — refusing write.`), { status: 403 });
  }
  if (supervisor !== expectedSupervisor) {
    throw Object.assign(
      new Error(
        `Row ${row.id} belongs to ${supervisor}, not ${expectedSupervisor}. Refusing write — supervisors can only edit their own rows.`
      ),
      { status: 403 }
    );
  }
  return { row, supervisor, sheet };
}

// Bust both caches after any write so the next read reflects the change.
function invalidateSheetCaches() {
  cachedSheet = null;
  cachedSheetWithAtt = null;
}

// ----- POST /lumina/smartsheet/update-notes ------------------------------
//
// Append or replace the NSC Project Notes cell on a job row. Only Billy's
// own rows are writable here; cross-supervisor edits are refused.
//
// Body: { jobId: string|number, notes: string, mode?: "replace" | "append" }
router.post("/lumina/smartsheet/update-notes", async (req: Request, res: Response) => {
  try {
    const { jobId, notes, mode } = (req.body ?? {}) as {
      jobId?: string | number;
      notes?: string;
      mode?: "replace" | "append";
    };
    if (jobId === undefined || jobId === null || jobId === "") {
      return res.status(400).json({ error: "jobId required (Work Order string or numeric rowId)." });
    }
    if (typeof notes !== "string") {
      return res.status(400).json({ error: "notes must be a string." });
    }
    const writeMode = mode === "append" ? "append" : "replace";

    const { row, sheet } = await resolveJobRow(jobId, SUPERVISOR_SCOPE);
    const byId = buildColumnsById(sheet);
    const rec = rowToRecord(row, byId);
    const existing = String(rec["NSC Project Notes"] ?? "");

    // Stamp the note with date + author so the history reads cleanly when
    // multiple notes pile up over a project's life. Format mirrors what the
    // supervisor would type by hand on the desktop.
    const stamp = new Date().toLocaleDateString("en-US", {
      month: "2-digit", day: "2-digit", year: "2-digit",
    });
    const stamped = `${stamp} - Billy: ${notes.trim()}`;

    const next = writeMode === "append" && existing
      ? `${existing}\n${stamped}`
      : stamped;

    const updated = await updateRowCells(row.id, { "NSC Project Notes": next }, sheet);
    invalidateSheetCaches();
    return res.json({
      ok: true,
      rowId: updated.id,
      jobId,
      mode: writeMode,
      newValue: next,
      modifiedAt: updated.modifiedAt,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    console.error("[lumina/smartsheet/update-notes] error:", err);
    return res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ----- POST /lumina/smartsheet/update-status -----------------------------
//
// Change Job Status (or Secondary Job Status) on a job row.
// Body: { jobId, status: string, kind?: "primary" | "secondary" }
router.post("/lumina/smartsheet/update-status", async (req: Request, res: Response) => {
  try {
    const { jobId, status, kind } = (req.body ?? {}) as {
      jobId?: string | number;
      status?: string;
      kind?: "primary" | "secondary";
    };
    if (jobId === undefined || jobId === null || jobId === "") {
      return res.status(400).json({ error: "jobId required." });
    }
    if (typeof status !== "string" || !status.trim()) {
      return res.status(400).json({ error: "status must be a non-empty string." });
    }
    const column = kind === "secondary" ? "Secondary Job Status" : "Job Status";

    const { row, sheet } = await resolveJobRow(jobId, SUPERVISOR_SCOPE);
    const updated = await updateRowCells(row.id, { [column]: status.trim() }, sheet);
    invalidateSheetCaches();
    return res.json({
      ok: true,
      rowId: updated.id,
      jobId,
      column,
      newValue: status.trim(),
      modifiedAt: updated.modifiedAt,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    console.error("[lumina/smartsheet/update-status] error:", err);
    return res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ----- POST /lumina/smartsheet/reschedule --------------------------------
//
// Move a job's Schedule Date (and optionally its End Date). Single-day jobs
// can pass scheduleDate only; multi-day must pass both.
//
// Body: { jobId, scheduleDate: "YYYY-MM-DD", endDate?: "YYYY-MM-DD" }
router.post("/lumina/smartsheet/reschedule", async (req: Request, res: Response) => {
  try {
    const { jobId, scheduleDate, endDate } = (req.body ?? {}) as {
      jobId?: string | number;
      scheduleDate?: string;
      endDate?: string;
    };
    if (jobId === undefined || jobId === null || jobId === "") {
      return res.status(400).json({ error: "jobId required." });
    }
    if (typeof scheduleDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
      return res.status(400).json({ error: "scheduleDate must be YYYY-MM-DD." });
    }
    if (endDate !== undefined && endDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ error: "endDate must be YYYY-MM-DD when provided." });
    }
    if (endDate && endDate < scheduleDate) {
      return res.status(400).json({ error: "endDate cannot be before scheduleDate." });
    }

    const { row, sheet } = await resolveJobRow(jobId, SUPERVISOR_SCOPE);
    const cells: Record<string, string | null> = { "Schedule Date": scheduleDate };
    if (endDate) cells["End Date"] = endDate;

    const updated = await updateRowCells(row.id, cells, sheet);
    invalidateSheetCaches();
    return res.json({
      ok: true,
      rowId: updated.id,
      jobId,
      scheduleDate,
      endDate: endDate ?? null,
      modifiedAt: updated.modifiedAt,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    console.error("[lumina/smartsheet/reschedule] error:", err);
    return res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
