/**
 * Ziply CAD fidelity report — measurable plan→map quality for QA harness.
 */
import type { Job } from "@nsc/types";

export type FidelityGrade = "A" | "B" | "C" | "D" | "F" | "N/A";

export type JobFidelityReport = {
  jobId: string;
  workOrder?: string | null;
  city?: string | null;
  hasPrint: boolean;
  mapReady: boolean;
  enhanced: boolean;
  geometrySource: string | null;
  residualM: number | null;
  controlCount: number;
  terminalsTotal: number;
  terminalsGeocoded: number;
  cablesTotal: number;
  cablesWithPath: number;
  drops: number;
  houseNumbers: number;
  stationTags: number;
  sheetXyTags: number;
  manualPins: number;
  grade: FidelityGrade;
  notes: string[];
};

function isValid(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  );
}

export function gradeFidelity(r: Omit<JobFidelityReport, "grade" | "notes"> & { notes?: string[] }): {
  grade: FidelityGrade;
  notes: string[];
} {
  const notes = r.notes ?? [];
  if (!r.hasPrint) return { grade: "N/A", notes: ["no print layer"] };
  if (!r.mapReady) return { grade: "F", notes: [...notes, "not on map"] };
  if (!r.enhanced) return { grade: "D", notes: [...notes, "not enhanced"] };

  const pathRatio = r.cablesTotal > 0 ? r.cablesWithPath / r.cablesTotal : 0;
  const geoRatio = r.terminalsTotal > 0 ? r.terminalsGeocoded / r.terminalsTotal : 0;
  const residual = r.residualM;

  if (
    (r.geometrySource === "control_registered" || r.geometrySource === "road_snapped") &&
    geoRatio >= 0.7 &&
    pathRatio >= 0.8 &&
    (residual == null || residual < 40)
  ) {
    return { grade: "A", notes };
  }
  if (
    r.geometrySource !== "synthetic" &&
    geoRatio >= 0.5 &&
    pathRatio >= 0.6 &&
    (residual == null || residual < 80)
  ) {
    return { grade: "B", notes };
  }
  if (pathRatio >= 0.4 && r.enhanced) {
    return { grade: "C", notes: [...notes, "partial paths / weak controls"] };
  }
  if (r.enhanced) {
    return { grade: "D", notes: [...notes, "synthetic or sparse geometry"] };
  }
  return { grade: "F", notes };
}

export function reportJobFidelity(job: Job): JobFidelityReport {
  const layer = job.ziplyPrintLayer;
  const mo = layer?.mapObjects;
  const hasPrint = !!mo;
  const hubOk = isValid(mo?.hub?.lat, mo?.hub?.lng);
  const terms = mo?.terminals ?? [];
  const cables = mo?.cables ?? [];
  const terminalsGeocoded = terms.filter((t) => isValid(t.lat, t.lng)).length;
  const mapReady =
    hubOk ||
    terminalsGeocoded > 0 ||
    (job.geocode?.status === "OK" && isValid(job.geocode.lat, job.geocode.lng));
  const cablesWithPath = cables.filter((c) => (c.path?.length ?? 0) >= 2).length;
  let houseNumbers = 0;
  let stationTags = 0;
  let sheetXyTags = 0;
  for (const t of terms) {
    houseNumbers += t.houseNumbers?.length ?? 0;
    if (t.stationFt != null) stationTags++;
    if (
      typeof (t as { sheetX?: number }).sheetX === "number" &&
      typeof (t as { sheetY?: number }).sheetY === "number"
    ) {
      sheetXyTags++;
    }
  }
  const manualPins = (mo as { manualPins?: unknown[] } | null)?.manualPins?.length ?? 0;
  const base = {
    jobId: job.jobId,
    workOrder: job.workOrder,
    city: job.city,
    hasPrint,
    mapReady,
    enhanced: !!layer?.printGeometryEnhancedAt,
    geometrySource: mo?.geometrySource ?? null,
    residualM: mo?.geometryResidualM ?? null,
    controlCount: terminalsGeocoded + (hubOk ? 1 : 0),
    terminalsTotal: terms.length,
    terminalsGeocoded,
    cablesTotal: cables.length,
    cablesWithPath,
    drops: mo?.dropSites?.length ?? 0,
    houseNumbers,
    stationTags,
    sheetXyTags,
    manualPins,
  };
  const { grade, notes } = gradeFidelity(base);
  return { ...base, grade, notes };
}

export type FleetFidelitySummary = {
  totalPrintJobs: number;
  mapReady: number;
  enhanced: number;
  byGrade: Record<FidelityGrade, number>;
  bySource: Record<string, number>;
  avgResidualM: number | null;
  jobs: JobFidelityReport[];
};

export function summarizeFleetFidelity(jobs: Job[]): FleetFidelitySummary {
  const reports = jobs
    .filter((j) => j.ziplyPrintLayer?.mapObjects)
    .map(reportJobFidelity);
  const byGrade: Record<FidelityGrade, number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    F: 0,
    "N/A": 0,
  };
  const bySource: Record<string, number> = {};
  let residualSum = 0;
  let residualN = 0;
  for (const r of reports) {
    byGrade[r.grade]++;
    const src = r.geometrySource ?? "none";
    bySource[src] = (bySource[src] ?? 0) + 1;
    if (r.residualM != null) {
      residualSum += r.residualM;
      residualN++;
    }
  }
  return {
    totalPrintJobs: reports.length,
    mapReady: reports.filter((r) => r.mapReady).length,
    enhanced: reports.filter((r) => r.enhanced).length,
    byGrade,
    bySource,
    avgResidualM: residualN > 0 ? residualSum / residualN : null,
    jobs: reports.sort((a, b) => {
      const order: FidelityGrade[] = ["F", "D", "C", "B", "A", "N/A"];
      return order.indexOf(a.grade) - order.indexOf(b.grade);
    }),
  };
}
