// Sync routes: Smartsheet inspect + sync trigger + status read.
import { Router } from "express";
import {
  getSheet,
  buildColumnsById,
  rowToRecord,
} from "../lib/smartsheet.js";

const router = Router();

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

export default router;
