// Ziply-only helpers. Do not use these to change Lumen markup behavior.
import type { Job } from "@nsc/types";
import { api } from "../../lib/api.js";
import { uploadZiplyPrint } from "../../lib/ziplyPrintStorage.js";

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

export type ZiplyPrintDocStatus = "none" | "processing" | "ready" | "failed";

export type ZiplyPrintFilter = "all" | "has_print" | "no_print" | "processing" | "failed";

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

/** Whether the job has a map-ready print design layer. */
export function hasZiplyPrintLayer(job: Job): boolean {
  return job.ziplyPrintLayer?.mapObjects != null;
}

function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/**
 * Best map anchor for a Ziply print layer (hub coords → job geocode → first
 * terminal with coords). Returns null if nothing is plottable — the #1 reason
 * an "ingested" print never appears on the map.
 */
export function getZiplyPrintAnchor(
  job: Job
): { lat: number; lng: number; source: "hub" | "geocode" | "terminal" } | null {
  const mo = job.ziplyPrintLayer?.mapObjects;
  if (!mo) return null;

  const hub = mo.hub;
  if (hub && isValidLatLng(hub.lat, hub.lng)) {
    return { lat: hub.lat as number, lng: hub.lng as number, source: "hub" };
  }

  if (job.geocode?.status === "OK" && isValidLatLng(job.geocode.lat, job.geocode.lng)) {
    return { lat: job.geocode.lat, lng: job.geocode.lng, source: "geocode" };
  }

  const terms = mo.terminals ?? [];
  for (const t of terms) {
    if (isValidLatLng(t.lat, t.lng)) {
      return { lat: t.lat as number, lng: t.lng as number, source: "terminal" };
    }
  }

  return null;
}

/** True when print data exists AND we can place it on the map. */
export function isZiplyPrintMapReady(job: Job): boolean {
  if (!isZiplyJob(job)) return false;
  if (!hasZiplyPrintLayer(job) && job.ziplyIngest?.status !== "complete") return false;
  if (!job.ziplyPrintLayer?.mapObjects) return false;
  return getZiplyPrintAnchor(job) != null;
}

/** Prefer Lake Stevens / print-ready jobs for default focus. */
export function pickZiplyFocusJob(jobs: Job[]): Job | null {
  const ziply = jobs.filter(isZiplyJob);
  if (ziply.length === 0) return null;
  const lakePrint = ziply.find((j) => isLakeStevensJob(j) && isZiplyPrintMapReady(j));
  if (lakePrint) return lakePrint;
  const lake = ziply.find((j) => isLakeStevensJob(j));
  if (lake) return lake;
  const anyPrint = ziply.find((j) => isZiplyPrintMapReady(j));
  if (anyPrint) return anyPrint;
  const anyLayer = ziply.find((j) => hasZiplyPrintLayer(j));
  if (anyLayer) return anyLayer;
  return ziply[0] ?? null;
}

export function getZiplyPrintDocStatus(job: Job): ZiplyPrintDocStatus {
  const ingest = job.ziplyIngest?.status;
  if (ingest === "processing") return "processing";
  if (ingest === "failed") return "failed";
  if (hasZiplyPrintLayer(job) || ingest === "complete") return "ready";
  if ((job.ziplyIngest?.storageFiles?.length ?? 0) > 0) return "processing";
  return "none";
}

export function ziplyPrintStatusLabel(status: ZiplyPrintDocStatus): string {
  switch (status) {
    case "ready":
      return "Print on map";
    case "processing":
      return "Ingesting…";
    case "failed":
      return "Ingest failed";
    default:
      return "No print";
  }
}

export function ziplyPrintStatusColor(status: ZiplyPrintDocStatus): string {
  switch (status) {
    case "ready":
      return "#00E676";
    case "processing":
      return "#38bdf8";
    case "failed":
      return "#f87171";
    default:
      return "#94a3b8";
  }
}

export function listZiplyPrintFiles(job: Job): Array<{
  name: string;
  size?: number;
  downloadUrl?: string;
  storagePath?: string;
}> {
  const files = job.ziplyIngest?.storageFiles ?? [];
  return files
    .filter((f) => f && (f.name || f.storagePath || f.downloadUrl))
    .map((f) => ({
      name: f?.name || f?.storagePath?.split("/").pop() || "print",
      size: f?.size,
      downloadUrl: f?.downloadUrl,
      storagePath: f?.storagePath,
    }));
}

export function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Upload print to Storage, kick off AI ingest, refresh jobs list. */
export async function ingestZiplyPrintForJob(
  jobId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  const uploaded = await uploadZiplyPrint(jobId, file, onProgress);
  await api.ziplyIngest(jobId, [
    {
      storagePath: uploaded.storagePath,
      downloadUrl: uploaded.downloadUrl,
      contentType: uploaded.contentType,
      name: uploaded.name,
      size: uploaded.size,
      storageBucket: uploaded.storageBucket,
    },
  ]);
  window.dispatchEvent(new Event("nsc:jobs-reload"));
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
  { id: "other", label: "Other permit" },
];

/** Upload permit PDF/image to Storage, kick off AI extract, refresh jobs. */
export async function ingestZiplyPermitForJob(
  jobId: string,
  file: File,
  permitType: ZiplyPermitTypeKey,
  onProgress?: (percent: number) => void
): Promise<void> {
  const uploaded = await uploadZiplyPrint(jobId, file, onProgress, { kind: "permit" });
  await api.ziplyPermitIngest(jobId, {
    permitType,
    storageFiles: [
      {
        storagePath: uploaded.storagePath,
        downloadUrl: uploaded.downloadUrl,
        contentType: uploaded.contentType,
        name: uploaded.name,
        size: uploaded.size,
        storageBucket: uploaded.storageBucket,
      },
    ],
  });
  window.dispatchEvent(new Event("nsc:jobs-reload"));
}

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

export function jobMatchesZiplyPrintFilter(job: Job, filter: ZiplyPrintFilter | undefined): boolean {
  if (!filter || filter === "all") return true;
  const st = getZiplyPrintDocStatus(job);
  if (filter === "has_print") return st === "ready";
  if (filter === "no_print") return st === "none";
  if (filter === "processing") return st === "processing";
  if (filter === "failed") return st === "failed";
  return true;
}
