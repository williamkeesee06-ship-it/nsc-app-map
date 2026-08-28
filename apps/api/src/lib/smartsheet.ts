// Smartsheet API client. Thin typed wrapper over fetch.
// Why: keeps every Smartsheet call in one place, with consistent auth + error shape.
// Docs: https://smartsheet.redoc.ly/#operation/getSheet

import { getEnv } from "../config/env.js";

const SS_BASE = "https://api.smartsheet.com/2.0";

export interface SmartsheetColumn {
  id: number;
  title: string;
  type: string;
  index: number;
  options?: string[];
  symbol?: string;
  // Report responses carry BOTH `id` (the underlying sheet column id) AND
  // `virtualId`. Report cells then reference `virtualColumnId`, so lookups
  // must be able to resolve either identifier.
  virtualId?: number;
}

export interface SmartsheetCell {
  columnId?: number;
  // Present on report responses only. Points at the report's virtual column id.
  virtualColumnId?: number;
  value?: string | number | boolean | null;
  displayValue?: string;
}

export interface SmartsheetAttachment {
  id: number;
  name?: string;
  attachmentType?: string;
  parentType?: string; // "ROW" | "SHEET" | "COMMENT"
  parentId?: number;  // row id when parentType=ROW
}

export interface SmartsheetRow {
  id: number;
  rowNumber: number;
  cells: SmartsheetCell[];
  createdAt?: string;
  modifiedAt?: string;
  attachments?: SmartsheetAttachment[]; // populated when getSheet({withAttachments:true})
}

export interface SmartsheetSheet {
  id: number;
  name: string;
  totalRowCount: number;
  columns: SmartsheetColumn[];
  rows: SmartsheetRow[];
  /**
   * Which Smartsheet endpoint produced this data.
   *  - "sheet"  : GET /sheets/{id}?includeAll=true. Cells key on `columnId`.
   *              Supports PUT /sheets/{id}/rows (updateRowCells).
   *  - "report" : GET /reports/{id}?pageSize=500&page=N. Cells key on
   *              `virtualColumnId`. Read-only: PUT /rows is REJECTED by
   *              Smartsheet for reports, so updateRowCells cannot be called
   *              against a report id (callers must resolve the underlying
   *              sheet id first).
   */
  kind: "sheet" | "report";
}

async function ssFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getEnv();
  if (!env.SMARTSHEET_API_TOKEN) {
    throw new Error("[smartsheet] SMARTSHEET_API_TOKEN missing");
  }
  const res = await fetch(`${SS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.SMARTSHEET_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(`[smartsheet] ${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as T;
}

export interface GetSheetOpts {
  /** When true, also pull per-row attachments so each row.attachments is populated. */
  withAttachments?: boolean;
}

/**
 * Load a tracker by id, accepting EITHER a sheet id or a report id.
 *
 * Smartsheet exposes trackers under two endpoints:
 *   - /sheets/{id}   -> paginates internally via includeAll=true
 *   - /reports/{id}  -> paginates explicitly via ?page=N&pageSize=500
 *
 * The id itself does not indicate which kind it is (both are numeric), so we
 * try the sheet endpoint first and fall back to the report endpoint on 404.
 * Report responses use `virtualColumnId` on cells and `virtualId` on columns
 * -- `buildColumnsById` below indexes BOTH so downstream `rowToRecord` calls
 * resolve either shape without branching.
 *
 * Reports carry no `totalRowCount` field, so we synthesize it from rows.length.
 */
export async function getSheet(
  opts: GetSheetOpts = {},
  sheetId?: string
): Promise<SmartsheetSheet> {
  const env = getEnv();
  const targetId = sheetId ?? env.SMARTSHEET_SHEET_ID;
  if (!targetId) {
    throw new Error("[smartsheet] Sheet ID missing");
  }

  // --- try sheet endpoint first --------------------------------------------
  const includes: string[] = [];
  if (opts.withAttachments) includes.push("attachments");
  const includeQs = includes.length ? `&include=${includes.join(",")}` : "";

  const sheetRes = await ssFetchRaw(
    `/sheets/${encodeURIComponent(targetId)}?includeAll=true${includeQs}`
  );
  if (sheetRes.ok) {
    const body = sheetRes.body as SmartsheetSheet;
    return { ...body, kind: "sheet" };
  }
  // Auth failures are the same for both endpoints -- surface immediately.
  if (sheetRes.status === 401 || sheetRes.status === 403) {
    throw new Error(
      `[smartsheet] ${sheetRes.status} on /sheets/${targetId}: token rejected. ${sheetRes.bodyText}`
    );
  }
  // Only 404 means "try report endpoint". Anything else is a real failure.
  if (sheetRes.status !== 404) {
    throw new Error(
      `[smartsheet] ${sheetRes.status} on /sheets/${targetId}: ${sheetRes.bodyText}`
    );
  }

  // --- fall back to report endpoint ----------------------------------------
  // Reports do NOT support the `attachments` include, so opts.withAttachments
  // is silently ignored on this path (there is no per-row attachment data on
  // a report anyway -- attachments live on the underlying sheet row).
  const pageSize = 500;
  let page = 1;
  let totalPages = 1;
  let name = "";
  let columns: SmartsheetColumn[] = [];
  const rows: SmartsheetRow[] = [];

  // Hard cap of 40 pages (= 20,000 rows) as a runaway guard.
  do {
    const r = await ssFetchRaw(
      `/reports/${encodeURIComponent(targetId)}?pageSize=${pageSize}&page=${page}`
    );
    if (!r.ok) {
      if (r.status === 404) {
        throw new Error(
          `[smartsheet] No sheet or report found with id ${targetId}.`
        );
      }
      if (r.status === 401 || r.status === 403) {
        throw new Error(
          `[smartsheet] ${r.status} on /reports/${targetId}: token rejected. ${r.bodyText}`
        );
      }
      throw new Error(
        `[smartsheet] ${r.status} on /reports/${targetId}: ${r.bodyText}`
      );
    }
    const body = r.body as SmartsheetSheet & { totalPages?: number };
    if (page === 1) {
      name = body.name ?? "";
      columns = body.columns ?? [];
    }
    if (Array.isArray(body.rows)) rows.push(...body.rows);
    totalPages = body.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages && page <= 40);

  return {
    // Reports don't expose a numeric `id`, so echo the caller-supplied string
    // as a number-ish value only used for logging; downstream never reads it.
    id: Number(targetId) || 0,
    name,
    totalRowCount: rows.length,
    columns,
    rows,
    kind: "report",
  };
}

/**
 * Low-level fetch that returns the raw {ok, status, body, bodyText} shape.
 * Used by getSheet() to distinguish "try the other endpoint" (404) from
 * "give up" (401/403/5xx). All other callers should use ssFetch().
 */
async function ssFetchRaw(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; body: unknown; bodyText: string }> {
  const env = getEnv();
  if (!env.SMARTSHEET_API_TOKEN) {
    throw new Error("[smartsheet] SMARTSHEET_API_TOKEN missing");
  }
  const res = await fetch(`${SS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.SMARTSHEET_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const bodyText = await res.text().catch(() => "");
  let body: unknown = null;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      // Non-JSON body -- keep as text for the error message.
    }
  }
  return { ok: res.ok, status: res.status, body, bodyText };
}

// Convenience: build a {columnTitle -> cellValue} record from a row.
// Uses displayValue when present (formatted strings), else raw value.
//
// Report cells reference `virtualColumnId`; sheet cells reference `columnId`.
// A report cell can carry either, so try both -- `buildColumnsById` registers
// each column under BOTH ids, so whichever the cell exposes resolves.
export function rowToRecord(
  row: SmartsheetRow,
  columnsById: Map<number, SmartsheetColumn>
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const cell of row.cells) {
    const col =
      (cell.virtualColumnId !== undefined ? columnsById.get(cell.virtualColumnId) : undefined) ??
      (cell.columnId !== undefined ? columnsById.get(cell.columnId) : undefined);
    if (!col) continue;
    const v = cell.displayValue ?? cell.value ?? null;
    out[col.title] = v;
  }
  return out;
}

/**
 * Index every column by BOTH its `id` and (when present) its `virtualId`.
 *
 * A report response carries columns with `{ id, virtualId }` -- the `id` is
 * the underlying sheet column, `virtualId` is the report-scoped id that the
 * report's cells actually reference. Keying on only one of them means half
 * the cells resolve nothing and every row looks empty.
 *
 * Sheet responses only carry `id`, so the extra registration is a no-op.
 */
export function buildColumnsById(sheet: SmartsheetSheet): Map<number, SmartsheetColumn> {
  const map = new Map<number, SmartsheetColumn>();
  for (const c of sheet.columns) {
    if (c.id !== undefined) map.set(c.id, c);
    if (c.virtualId !== undefined) map.set(c.virtualId, c);
  }
  return map;
}

export function buildColumnsByTitle(sheet: SmartsheetSheet): Map<string, SmartsheetColumn> {
  return new Map(sheet.columns.map((c) => [c.title, c]));
}

/**
 * Update one or more cells on an existing row. Returns the server-echoed row.
 *
 * `cells` is keyed by column TITLE (e.g. "NSC Project Notes") to keep callers
 * readable; we resolve titles to column ids internally. Pass `null` to clear
 * a cell, an ISO yyyy-MM-dd string for DATE columns, a string for TEXT, or
 * any of the PICKLIST allowed values for status-like columns.
 *
 * Notes:
 *  - Smartsheet accepts an ARRAY of row objects under PUT /sheets/{id}/rows.
 *    We always send one row; this is the documented "update rows" endpoint.
 *  - We pass `strict: false` so date strings without timezone ("2026-06-22")
 *    are accepted on DATE columns without fighting the API.
 *  - We never set formula cells (Duration, etc.) — if a caller passes one
 *    by accident the API will reject the whole row; that's the right
 *    failure mode.
 */
export async function updateRowCells(
  rowId: number,
  cells: Record<string, string | number | boolean | null>,
  sheet?: SmartsheetSheet,
  sheetId?: string
): Promise<SmartsheetRow> {
  const env = getEnv();
  const targetSheetId = sheetId ?? env.SMARTSHEET_SHEET_ID;
  if (!targetSheetId) {
    throw new Error("[smartsheet] Sheet ID missing");
  }
  const resolvedSheet = sheet ?? (await getSheet({}, targetSheetId));
  // Reports are read-only through this API -- PUT /rows only exists on the
  // sheet endpoint. Fail loudly so a caller pointed at a report id can fix
  // the wiring instead of getting a Smartsheet 400 with no explanation.
  if (resolvedSheet.kind === "report") {
    throw new Error(
      `[smartsheet] updateRowCells called against a REPORT id (${targetSheetId}). Reports are read-only; pass the underlying sheet id instead.`
    );
  }
  const byTitle = buildColumnsByTitle(resolvedSheet);
  const cellPayload: Array<{ columnId: number; value: string | number | boolean | null; strict?: boolean }> = [];
  for (const [title, value] of Object.entries(cells)) {
    const col = byTitle.get(title);
    if (!col) {
      throw new Error(`[smartsheet] Unknown column "${title}" (sheet has: ${[...byTitle.keys()].join(", ")})`);
    }
    cellPayload.push({ columnId: col.id, value, strict: false });
  }
  if (cellPayload.length === 0) {
    throw new Error("[smartsheet] updateRowCells called with no cells");
  }
  const body = [{ id: rowId, cells: cellPayload }];
  const response = await ssFetch<{ result: SmartsheetRow[] | SmartsheetRow }>(
    `/sheets/${targetSheetId}/rows`,
    { method: "PUT", body: JSON.stringify(body) }
  );
  // Smartsheet sometimes returns an array, sometimes one row. Normalize.
  if (Array.isArray(response.result)) return response.result[0];
  return response.result;
}

/**
 * Locate a row by its Work Order value (any case, trimmed). Returns null if
 * no row matches. Used by the propose-write endpoints so callers can address
 * a job by its human name ("P.362908") instead of the numeric rowId.
 */
export function findRowByWorkOrder(
  sheet: SmartsheetSheet,
  workOrder: string
): SmartsheetRow | null {
  const target = String(workOrder).trim().toLowerCase();
  if (!target) return null;
  const byId = buildColumnsById(sheet);
  for (const row of sheet.rows) {
    const rec = rowToRecord(row, byId);
    const wo = String(rec["Work Order"] ?? "").trim().toLowerCase();
    if (wo === target) return row;
  }
  return null;
}
