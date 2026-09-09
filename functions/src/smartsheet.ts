// Phase 5 — Smartsheet write-back. When a ticket transitions to Filed we push
// the ITIC-assigned locate number and its expiration date back onto the job's
// row in the master schedule sheet.
//
// Column IDs and the sheet ID are fixed for North Sky's "Master Schedule".
import smartsheetClient from "smartsheet";
import type { Job } from "./types.js";

const SHEET_ID = 1833739362822020;
const COL_WORK_ORDER = 4680657223346052;
const COL_LOCATE_NUMBER = 7141137686783876;
const COL_LOCATE_EXPIRATION = 1511638152570756;
// Fallback match keys when the work order is blank on a row.
const COL_ADDRESS = 2428857409661316; // Address column
const COL_ZIP = 6932457037031812; // Zip column

interface SmartsheetRow {
  id: number;
  cells: { columnId: number; value?: unknown; displayValue?: string }[];
}

function client() {
  const token = process.env.SMARTSHEET_ACCESS_TOKEN;
  if (!token) throw new Error("SMARTSHEET_ACCESS_TOKEN is not set");
  return smartsheetClient.createClient({ accessToken: token, logLevel: "info" });
}

function cellValue(row: SmartsheetRow, columnId: number): string {
  const cell = row.cells.find((c) => c.columnId === columnId);
  return (cell?.displayValue ?? (cell?.value as string | undefined) ?? "").toString().trim();
}

// Locate the master-schedule row for a job: prefer Work Order, fall back to
// Address + Zip. Returns null if no confident match.
async function findRow(ss: ReturnType<typeof client>, job: Job): Promise<number | null> {
  const sheet = (await ss.sheets.getSheet({ id: SHEET_ID })) as { rows: SmartsheetRow[] };
  const wo = (job.workOrder ?? "").trim();
  if (wo) {
    const byWo = sheet.rows.find((r) => cellValue(r, COL_WORK_ORDER) === wo);
    if (byWo) return byWo.id;
  }
  const addr = (job.address ?? "").trim().toLowerCase();
  const zip = (job.zip ?? "").trim();
  if (addr && zip) {
    const byAddr = sheet.rows.find(
      (r) =>
        cellValue(r, COL_ADDRESS).toLowerCase() === addr && cellValue(r, COL_ZIP) === zip
    );
    if (byAddr) return byAddr.id;
  }
  return null;
}

export interface WritebackInput {
  job: Job;
  ticketNumber: string;
  expiresAt: number | null;
}

// Write locate number + expiration back to the job's row. No-op (returns false)
// if the row can't be found so a bad match never throws the whole file flow.
export async function writeLocateBack(input: WritebackInput): Promise<boolean> {
  const ss = client();
  const rowId = await findRow(ss, input.job);
  if (rowId == null) return false;

  const cells: { columnId: number; value: string }[] = [
    { columnId: COL_LOCATE_NUMBER, value: input.ticketNumber },
  ];
  if (input.expiresAt) {
    cells.push({
      columnId: COL_LOCATE_EXPIRATION,
      value: new Date(input.expiresAt).toISOString().slice(0, 10),
    });
  }

  await ss.sheets.updateRow({
    sheetId: SHEET_ID,
    body: [{ id: rowId, cells }],
  });
  return true;
}
