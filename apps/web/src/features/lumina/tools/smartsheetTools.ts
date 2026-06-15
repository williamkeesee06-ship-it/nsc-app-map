/**
 * Smartsheet read tools — all scoped server-side to Construction Supervisor
 * = "Billy Keesee". The browser cannot widen scope, even if the model tries.
 *
 *   listSmartsheetRows(q?, limit?, fields?)
 *     List rows. Optional `q` substring matches across the projection.
 *     Optional `fields` adds extra column titles beyond the default lean set.
 *
 *   getSmartsheetRow(rowId)
 *     Fetch a single row by id with EVERY column. Use when Lumina needs
 *     detail the projection didn't include.
 *
 *   searchSmartsheetByJob(workOrder)
 *     The most common path — "what does Smartsheet say about job 4521".
 *     Tolerant of "WO 4521", "#4521", "4521".
 *
 * All three are READ-ONLY. Write-through (to Firestore + Smartsheet) lands
 * in Sprint 1.4 as a propose-pattern tool with the approval card.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// listSmartsheetRows
// ─────────────────────────────────────────────────────────────────────────────

interface ListRowsInput {
  /** Case-insensitive substring filter across the lean projection. */
  q?: string;
  /** Max rows to return, 1-200. Default 25. */
  limit?: number;
  /** Extra column titles to include beyond the default lean projection. */
  fields?: string[];
}

interface RowStub {
  rowId: number;
  rowNumber: number;
  modifiedAt?: string;
  fields: Record<string, string | number | boolean | null>;
}

interface ListRowsData {
  scope: string;
  totalReturned: number;
  sheetName: string;
  sheetId: string;
  cachedSeconds: number;
  rows: RowStub[];
}

async function runListRows(
  input: ListRowsInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<ListRowsData>> {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.limit) params.set("limit", String(input.limit));
  if (input.fields && input.fields.length > 0) {
    params.set("fields", input.fields.join(","));
  }
  const res = await fetch(`/api/lumina/smartsheet/rows?${params.toString()}`);
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? "";
    } catch { /* ignore */ }
    return {
      ok: false,
      message: `Smartsheet unavailable (${res.status}).${detail ? " " + detail : ""}`,
    };
  }
  const body = (await res.json()) as ListRowsData;
  return {
    ok: true,
    message:
      body.totalReturned === 0
        ? input.q
          ? `No rows in your scope matching "${input.q}".`
          : "No rows in your Smartsheet scope right now."
        : `${body.totalReturned} rows from ${body.sheetName} (your scope).`,
    data: body,
  };
}

export const listSmartsheetRowsTool: LuminaTool<ListRowsInput, ListRowsData> = {
  name: "listSmartsheetRows",
  description:
    "List rows from Billy's Smartsheet Operations Tracker, scoped server-side to Construction Supervisor = Billy Keesee. Returns rowId + Work Order + Job Status + Address + City + Schedule Date + Crew/Foreman + Work Type + Notes + Modified. Use 'q' to filter (e.g. q:'Tacoma' or q:'In Progress'). Use 'fields' to pull extra columns beyond the default. Read-only.",
  kind: "read",
  run: runListRows,
};

// ─────────────────────────────────────────────────────────────────────────────
// getSmartsheetRow
// ─────────────────────────────────────────────────────────────────────────────

interface GetRowInput {
  rowId: number;
}

interface GetRowData {
  rowId: number;
  rowNumber: number;
  modifiedAt?: string;
  fields: Record<string, string | number | boolean | null>;
}

async function runGetRow(
  input: GetRowInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<GetRowData>> {
  if (typeof input.rowId !== "number" || input.rowId <= 0) {
    return { ok: false, message: "getSmartsheetRow requires a numeric rowId from listSmartsheetRows." };
  }
  const res = await fetch(`/api/lumina/smartsheet/rows/${input.rowId}`);
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? "";
    } catch { /* ignore */ }
    return {
      ok: false,
      message: `Smartsheet row ${input.rowId} unavailable (${res.status}).${detail ? " " + detail : ""}`,
    };
  }
  const body = (await res.json()) as GetRowData;
  return {
    ok: true,
    message: `Full Smartsheet row #${body.rowNumber} (${Object.keys(body.fields).length} columns).`,
    data: body,
  };
}

export const getSmartsheetRowTool: LuminaTool<GetRowInput, GetRowData> = {
  name: "getSmartsheetRow",
  description:
    "Fetch a full Smartsheet row (every column) by its rowId from listSmartsheetRows. Use when the default projection didn't include a column Billy asked about. Returns 404 for rows outside Billy's supervisor scope. Read-only.",
  kind: "read",
  run: runGetRow,
};

// ─────────────────────────────────────────────────────────────────────────────
// searchSmartsheetByJob
// ─────────────────────────────────────────────────────────────────────────────

interface SearchByJobInput {
  workOrder: string;
}

interface SearchByJobData {
  scope: string;
  workOrder: string;
  totalReturned: number;
  rows: RowStub[];
  zeroMatchHint?: string;
}

async function runSearchByJob(
  input: SearchByJobInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<SearchByJobData>> {
  const wo = (input.workOrder ?? "").trim();
  if (!wo) return { ok: false, message: "searchSmartsheetByJob requires a workOrder." };
  const res = await fetch(`/api/lumina/smartsheet/by-job/${encodeURIComponent(wo)}`);
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? "";
    } catch { /* ignore */ }
    return {
      ok: false,
      message: `Smartsheet lookup failed (${res.status}).${detail ? " " + detail : ""}`,
    };
  }
  const body = (await res.json()) as SearchByJobData;
  return {
    ok: true,
    message:
      body.totalReturned === 0
        ? `No Smartsheet rows in your scope for Work Order "${wo}".`
        : `Found ${body.totalReturned} Smartsheet row(s) for "${wo}".`,
    data: body,
  };
}

export const searchSmartsheetByJobTool: LuminaTool<SearchByJobInput, SearchByJobData> = {
  name: "searchSmartsheetByJob",
  description:
    "Find Smartsheet rows by Work Order number. Tolerant of formats: 'WO 4521', '#4521', '4521'. Returns the full record (every column) for each match in Billy's supervisor scope. Use this whenever Billy mentions a job number and you need the Smartsheet view. Read-only.",
  kind: "read",
  run: runSearchByJob,
};

export const smartsheetTools = [
  listSmartsheetRowsTool,
  getSmartsheetRowTool,
  searchSmartsheetByJobTool,
];
