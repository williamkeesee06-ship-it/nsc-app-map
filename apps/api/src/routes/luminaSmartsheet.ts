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
  type SmartsheetSheet,
} from "../lib/smartsheet.js";

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
let cachedSheet: { at: number; sheet: SmartsheetSheet } | null = null;

async function getSheetCached(): Promise<SmartsheetSheet> {
  const now = Date.now();
  if (cachedSheet && now - cachedSheet.at < SHEET_TTL_MS) {
    return cachedSheet.sheet;
  }
  const sheet = await getSheet();
  cachedSheet = { at: now, sheet };
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

export default router;
