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
