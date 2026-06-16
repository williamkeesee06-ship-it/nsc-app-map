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
}

export interface SmartsheetCell {
  columnId: number;
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

export async function getSheet(opts: GetSheetOpts = {}): Promise<SmartsheetSheet> {
  const env = getEnv();
  if (!env.SMARTSHEET_SHEET_ID) {
    throw new Error("[smartsheet] SMARTSHEET_SHEET_ID missing");
  }
  // Smartsheet's GET /sheets/{id} defaults to 100 rows per page. With our
  // tracker holding 500+ rows we MUST request the whole sheet, otherwise the
  // sync only sees the first 100 (and off-tracker logic then flags the rest).
  const includes: string[] = [];
  if (opts.withAttachments) includes.push("attachments");
  const includeQs = includes.length ? `&include=${includes.join(",")}` : "";
  return ssFetch<SmartsheetSheet>(
    `/sheets/${env.SMARTSHEET_SHEET_ID}?includeAll=true${includeQs}`
  );
}

// Convenience: build a {columnTitle -> cellValue} record from a row.
// Uses displayValue when present (formatted strings), else raw value.
export function rowToRecord(
  row: SmartsheetRow,
  columnsById: Map<number, SmartsheetColumn>
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const cell of row.cells) {
    const col = columnsById.get(cell.columnId);
    if (!col) continue;
    const v = cell.displayValue ?? cell.value ?? null;
    out[col.title] = v;
  }
  return out;
}

export function buildColumnsById(sheet: SmartsheetSheet): Map<number, SmartsheetColumn> {
  return new Map(sheet.columns.map((c) => [c.id, c]));
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
  sheet?: SmartsheetSheet
): Promise<SmartsheetRow> {
  const env = getEnv();
  if (!env.SMARTSHEET_SHEET_ID) {
    throw new Error("[smartsheet] SMARTSHEET_SHEET_ID missing");
  }
  const resolvedSheet = sheet ?? (await getSheet());
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
    `/sheets/${env.SMARTSHEET_SHEET_ID}/rows`,
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
