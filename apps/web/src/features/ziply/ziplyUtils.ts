// Ziply-only helpers. Do not use these to change Lumen markup behavior.
import type { Job } from "@nsc/types";
import { api } from "../../lib/api.js";


/** WA North Metro / North Puget Sound cities commonly on Ziply FTTH trackers. */
export const NORTH_METRO_CITIES = [
  "arlington",
  "bothell",
  "edmonds",
  "everett",
  "granite falls",
  "kenmore",
  "lake stevens",
  "lynnwood",
  "marysville",
  "mill creek",
  "monroe",
  "mountlake terrace",
  "mukilteo",
  "shoreline",
  "snohomish",
  "stanwood",
  "woodinville",
] as const;


/** Client-side CAD fidelity grade (mirrors server ziplyFidelity). */
export type CadFidelityGrade = "A" | "B" | "C" | "D" | "F" | "N/A";

export function getCadFidelity(job: Job): {
  grade: CadFidelityGrade;
  label: string;
  color: string;
  source: string | null;
  residualM: number | null;
} {
  const mo = job.ziplyPrintLayer?.mapObjects;
  if (!mo) {
    return { grade: "N/A", label: "No print", color: "#64748b", source: null, residualM: null };
  }
  const source = mo.geometrySource ?? null;
  const residualM = mo.geometryResidualM ?? null;
  const enhanced = !!job.ziplyPrintLayer?.printGeometryEnhancedAt;
  const terms = mo.terminals ?? [];
  const geoN = terms.filter(
    (t) => typeof t.lat === "number" && typeof t.lng === "number" && t.lat && t.lng
  ).length;
  const cables = mo.cables ?? [];
  const pathN = cables.filter((c) => (c.path?.length ?? 0) >= 2).length;
  const geoRatio = terms.length > 0 ? geoN / terms.length : 0;
  const pathRatio = cables.length > 0 ? pathN / cables.length : 0;

  if (geoN === 0 && pathN === 0) {
    return { grade: "F", label: "Off map", color: "#f87171", source, residualM };
  }
  if (!enhanced) {
    return { grade: "D", label: "Not enhanced", color: "#fbbf24", source, residualM };
  }
  if (
    (source === "control_registered" || source === "road_snapped") &&
    geoRatio >= 0.7 &&
    pathRatio >= 0.8 &&
    (residualM == null || residualM < 40)
  ) {
    return {
      grade: "A",
      label: residualM != null ? `A · ±${Math.round(residualM)}m` : "A · registered",
      color: "#1d4ed8",
      source,
      residualM,
    };
  }
  if (
    source !== "synthetic" &&
    geoRatio >= 0.5 &&
    pathRatio >= 0.6 &&
    (residualM == null || residualM < 80)
  ) {
    return {
      grade: "B",
      label: residualM != null ? `B · ±${Math.round(residualM)}m` : "B · good",
      color: "#38bdf8",
      source,
      residualM,
    };
  }
  if (pathRatio >= 0.4) {
    return { grade: "C", label: "C · partial", color: "#a78bfa", source, residualM };
  }
  return { grade: "D", label: "D · synthetic", color: "#fb923c", source, residualM };
}

export function isNorthMetroJob(job: Job): boolean {
  const base = (job.constructionBase ?? "").trim().toLowerCase();
  if (base.includes("north metro") || base.includes("northmetro") || base.includes("n. metro")) {
    return true;
  }
  const city = (job.city ?? "").trim().toLowerCase();
  if (!city) return false;
  if ((NORTH_METRO_CITIES as readonly string[]).includes(city)) return true;
  // "Lake Stevens", "LAKE STEVENS, WA", etc.
  return NORTH_METRO_CITIES.some(
    (c) => city === c || city.startsWith(c + " ") || city.startsWith(c + ",") || city.includes(c)
  );
}

/** Ziply contract row (sheet may use "Ziply", "ZIPLY", "Ziply FTTH", …). */
export function isZiplyJob(job: Job): boolean {
  const cp = (job.customerProject ?? "").trim().toLowerCase();
  if (cp.includes("ziply")) return true;
  // Print layer / ingest is Ziply-only in this app
  if (job.ziplyPrintLayer?.mapObjects != null) return true;
  if (job.ziplyIngest?.status) return true;
  return false;
}

export function isLakeStevensJob(job: Job): boolean {
  const city = (job.city ?? "").trim().toLowerCase();
  const addr = (job.address ?? "").trim().toLowerCase();
  const notes = (job.nscProjectNotes ?? "").trim().toLowerCase();
  return (
    city.includes("lake stevens") ||
    addr.includes("lake stevens") ||
    notes.includes("lake stevens")
  );
}





/** Prefer Lake Stevens jobs for default focus. */
export function pickZiplyFocusJob(jobs: Job[]): Job | null {
  const ziply = jobs.filter(isZiplyJob);
  if (ziply.length === 0) return null;
  const lake = ziply.find((j) => isLakeStevensJob(j));
  if (lake) return lake;
  return ziply[0] ?? null;
}





export function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Plant progress from build statuses (this job only). */
export type PlantProgress = {
  complete: number;
  inProgress: number;
  planned: number;
  total: number;
  /** Weighted: complete=1, in_progress=0.5, planned=0 */
  progressPct: number;
  /** Footage-weighted when lengthFt available */
  footagePct: number | null;
  completeFt: number;
  totalFt: number;
};

export function computePlantProgress(
  job: Job,
  overrides?: Record<string, "planned" | "in_progress" | "complete">
): PlantProgress {
  const mo = job.ziplyPrintLayer?.mapObjects;
  let complete = 0;
  let inProgress = 0;
  let planned = 0;
  let completeFt = 0;
  let totalFt = 0;

  const stOf = (
    kind: string,
    ref: string,
    stored?: "planned" | "in_progress" | "complete" | null
  ) => overrides?.[`${job.jobId}:${kind}:${ref}`] ?? stored ?? "planned";

  const count = (
    kind: string,
    ref: string,
    stored: "planned" | "in_progress" | "complete" | null | undefined,
    ft: number | null | undefined
  ) => {
    const st = stOf(kind, ref, stored);
    if (st === "complete") complete++;
    else if (st === "in_progress") inProgress++;
    else planned++;
    if (ft != null && ft > 0) {
      totalFt += ft;
      if (st === "complete") completeFt += ft;
      else if (st === "in_progress") completeFt += ft * 0.5;
    }
  };

  if (mo) {
    count("hub", "hub", mo.hub?.status, null);
    for (const c of mo.cables ?? []) {
      count("cable", c.label, c.status, c.lengthFt);
    }
    for (const t of mo.terminals ?? []) {
      count("terminal", t.label, t.status, t.footageFt);
    }
  }

  // Smartsheet field progress (bore / placing / aerial) when present
  const estBore = job.estBoreFt ?? 0;
  const doneBore = job.completedBoreFt ?? 0;
  const estPlace = job.estPlacingFt ?? 0;
  const donePlace = job.completedPlacingFt ?? 0;
  const estAer = job.estAerialFt ?? 0;
  const doneAer = job.completedAerialFt ?? 0;
  const sheetEst = estBore + estPlace + estAer;
  const sheetDone = doneBore + donePlace + doneAer;

  // Job-level status hint
  const js = (job.jobStatus ?? "").toLowerCase();
  const ss = (job.secondaryJobStatus ?? "").toLowerCase();
  let sheetStatusBoost: number | null = null;
  if (job.actualCompletionDate || js.includes("complete") || ss.includes("complete")) {
    sheetStatusBoost = 100;
  } else if (js.includes("progress") || ss.includes("progress") || ss.includes("construction")) {
    sheetStatusBoost = 45;
  }

  const total = complete + inProgress + planned;
  const objectPct =
    total === 0 ? 0 : Math.round(((complete + inProgress * 0.5) / total) * 100);
  const plantFootagePct =
    totalFt > 0 ? Math.round((completeFt / totalFt) * 100) : null;
  const sheetFootagePct =
    sheetEst > 0 ? Math.min(100, Math.round((sheetDone / sheetEst) * 100)) : null;

  // Prefer Smartsheet footage when available, else plant object/footage blend
  let progressPct = objectPct;
  if (sheetFootagePct != null) {
    progressPct =
      plantFootagePct != null
        ? Math.round(sheetFootagePct * 0.65 + plantFootagePct * 0.35)
        : sheetFootagePct;
  } else if (plantFootagePct != null) {
    progressPct = plantFootagePct;
  } else if (sheetStatusBoost != null && total === 0) {
    progressPct = sheetStatusBoost;
  }

  // If sheet says complete, never show 0%
  if (sheetStatusBoost === 100) progressPct = Math.max(progressPct, 95);

  return {
    complete,
    inProgress,
    planned,
    total,
    progressPct,
    footagePct: sheetFootagePct ?? plantFootagePct,
    completeFt: sheetEst > 0 ? sheetDone : completeFt,
    totalFt: sheetEst > 0 ? sheetEst : totalFt,
  };
}

/** Ordered build sequence for play mode: feeder → mainline → laterals by sequence/distance. */
export function buildConstructionSequence(job: Job): Array<{
  kind: "hub" | "cable" | "terminal";
  ref: string;
  label: string;
  role?: string | null;
}> {
  const mo = job.ziplyPrintLayer?.mapObjects;
  if (!mo) return [];
  const out: Array<{
    kind: "hub" | "cable" | "terminal";
    ref: string;
    label: string;
    role?: string | null;
  }> = [];
  out.push({
    kind: "hub",
    ref: "hub",
    label: job.ziplyPrintLayer?.hubId || "FDH",
  });
  // Single sort by role priority then sequence — avoid 3 filter passes
  const roleRank = (r: string | null | undefined) =>
    r === "feeder" ? 0 : r === "mainline" ? 1 : 2;
  const cables = [...(mo.cables ?? [])].sort((a, b) => {
    const rr = roleRank(a.role) - roleRank(b.role);
    if (rr !== 0) return rr;
    return (a.sequenceOrder ?? 999) - (b.sequenceOrder ?? 999);
  });
  for (const c of cables) {
    out.push({
      kind: "cable",
      ref: c.label,
      label: c.label,
      role: c.role,
    });
  }
  const terms = [...(mo.terminals ?? [])].sort(
    (a, b) => (a.sequenceOrder ?? 999) - (b.sequenceOrder ?? 999)
  );
  for (const t of terms) {
    out.push({ kind: "terminal", ref: t.label, label: t.label });
  }
  return out;
}

/** Selection shared between map overlay and Print Studio */
export type ZiplyPlantSelection = {
  jobId: string;
  kind: "hub" | "terminal" | "cable";
  ref: string;
  label?: string;
};

export function emitZiplyPlantSelect(sel: ZiplyPlantSelection | null) {
  try {
    window.dispatchEvent(
      new CustomEvent("nsc:ziply-plant-select", { detail: sel })
    );
  } catch {
    /* ignore */
  }
}

export function emitZiplyPathEditRequest(detail: {
  jobId: string;
  cableLabel: string;
}) {
  try {
    window.dispatchEvent(
      new CustomEvent("nsc:ziply-path-edit", { detail })
    );
  } catch {
    /* ignore */
  }
}



export type ZiplyPermitTypeKey =
  | "cityRow"
  | "wsdot"
  | "county"
  | "railroad"
  | "pa"
  | "tcp"
  | "other";

export const ZIPLY_PERMIT_TYPES: { id: ZiplyPermitTypeKey; label: string }[] = [
  { id: "cityRow", label: "City ROW" },
  { id: "wsdot", label: "WSDOT" },
  { id: "county", label: "County" },
  { id: "railroad", label: "Railroad" },
  { id: "pa", label: "PGE / PA / Franchise" },
  { id: "tcp", label: "TCP (Traffic Control)" },
  { id: "other", label: "Other / Construction Site Plan" },
];



/** Ziply simple status groups for MAP filter checkboxes. */
export type ZiplyStatusGroup = "not_started" | "in_progress" | "complete";

export function ziplyStatusGroupForJob(job: Job): ZiplyStatusGroup {
  const s = (job.jobStatus || "").toLowerCase();
  if (
    s.includes("complete") ||
    s.includes("billing") ||
    s === "done" ||
    s.includes("closed")
  ) {
    return "complete";
  }
  if (
    s.includes("progress") ||
    s.includes("pending") ||
    s.includes("active") ||
    s.includes("construction")
  ) {
    return "in_progress";
  }
  return "not_started";
}


