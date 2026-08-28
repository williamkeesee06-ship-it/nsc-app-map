/**
 * Tool: listJobs (Phase Lumina+ — 6/15)
 *
 * Hits /api/jobs, scopes by supervisor unless manager, filters in-memory, and
 * returns a LEAN-but-INFORMATIVE projection that the model can answer most
 * questions from without follow-up getJob calls.
 *
 * What changed from v1:
 *   - Status matching now checks BOTH jobStatus AND secondaryJobStatus, with
 *     tolerant tokenization (spaces/dashes/case all collapse). "needs fielding"
 *     correctly matches values stored as "Needs Fielding", "NEEDS-FIELDING",
 *     "needsFielding", etc.
 *   - Projection now includes lat/lng (when geocoded), scopeOfWork-ish fields
 *     (workTypeTags + nscProjectNotes trimmed), and a `distanceMiles` when an
 *     origin is supplied.
 *   - New input: sortBy = "distance" | "scheduleDate" | "city" | "lastUpdated".
 *     distance requires originLat + originLng; other sorts work standalone.
 *   - Returns BOTH the projected list and the count separately so the model
 *     can trust `total` regardless of HARD_CAP truncation.
 *   - Honesty: when 0 results match, the tool message suggests the closest
 *     adjacent filter the model should try (e.g. "no exact match on status;
 *     5 jobs match secondaryJobStatus including 'needs fielding'").
 */

import type { Job } from "@nsc/types";
import { api } from "../../../lib/api.js";
import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface ListJobsInput {
  crew?: string;
  status?: string;
  olderThanDays?: number;
  city?: string;
  workType?: string;
  /** Sort the result set. */
  sortBy?: "distance" | "scheduleDate" | "city" | "lastUpdated";
  /** Required when sortBy === "distance". */
  originLat?: number;
  originLng?: number;
  /** Max rows to return (default 50, hard ceiling 200). */
  limit?: number;
}

interface ListedJob {
  jobId: string;
  workOrder: string;
  /** Primary status (jobStatus). */
  status: string | null;
  /** Phase status (secondaryJobStatus) — where "needs fielding" lives. */
  phase: string | null;
  crew: string | null;
  supervisor: string | null;
  city: string | null;
  address: string | null;
  scheduleDate: string | null;
  lastUpdatedDays: number | null;
  /** Geocoded location (null if not yet geocoded or geocode failed). */
  lat: number | null;
  lng: number | null;
  /** Scope-of-work cues — what the crew needs to actually do. */
  workTypeTags: string[];
  /** First ~240 chars of project notes (full text via getJob if needed). */
  notesPreview: string | null;
  /** Filled when origin supplied. Great-circle, miles. */
  distanceMiles: number | null;
}

interface ListJobsData {
  total: number;
  shown: number;
  jobs: ListedJob[];
  truncatedTo?: number;
  /** Echo so the model can quote the exact filter description. */
  filterDescription: string;
  /** Honesty hint — populated when 0 results but adjacent filters had matches. */
  zeroMatchHint?: string;
}

const DEFAULT_LIMIT = 50;
const HARD_CAP = 200;

/** Collapse whitespace, dashes, and case so "Needs-Fielding" == "needs fielding". */
function normalizeStatusToken(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, "");
}

/** Great-circle distance in miles via haversine. */
function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.7613; // earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function project(
  j: Job,
  now: number,
  origin?: { lat: number; lng: number } | null
): ListedJob {
  const updated = (j as Job & { updatedAt?: string | null }).updatedAt;
  let lastUpdatedDays: number | null = null;
  if (updated) {
    const t = Date.parse(updated);
    if (!Number.isNaN(t)) lastUpdatedDays = Math.floor((now - t) / 86_400_000);
  }
  const lat = j.geocode && j.geocode.status === "OK" ? j.geocode.lat : null;
  const lng = j.geocode && j.geocode.status === "OK" ? j.geocode.lng : null;
  const notes = j.nscProjectNotes ?? null;
  const notesPreview = notes ? (notes.length > 240 ? notes.slice(0, 240) + "…" : notes) : null;
  const distanceMiles =
    origin && lat !== null && lng !== null
      ? Math.round(haversineMiles(origin, { lat, lng }) * 10) / 10
      : null;
  return {
    jobId: j.jobId,
    workOrder: j.workOrder,
    status: j.jobStatus && j.jobStatus.trim() !== "" ? j.jobStatus : null,
    phase: j.secondaryJobStatus && j.secondaryJobStatus.trim() !== "" ? j.secondaryJobStatus : null,
    crew: j.constructionCrewForeman ?? null,
    supervisor: j.constructionSupervisor ?? null,
    city: j.city ?? null,
    address: j.address ?? null,
    scheduleDate: j.scheduleDate ?? null,
    lastUpdatedDays,
    lat,
    lng,
    workTypeTags: j.workTypeTags ?? [],
    notesPreview,
    distanceMiles,
  };
}

function statusMatches(j: Job, query: string): boolean {
  const q = normalizeStatusToken(query);
  const a = normalizeStatusToken(j.jobStatus ?? "");
  const b = normalizeStatusToken(j.secondaryJobStatus ?? "");
  // Use substring includes both ways so "needs fielding" finds
  // "Needs Fielding - awaiting permit" and vice versa.
  return a.includes(q) || b.includes(q) || q.includes(a) || q.includes(b);
}

function workTypeMatches(j: Job, query: string): boolean {
  const q = query.toLowerCase();
  if ((j.workType ?? "").toLowerCase().includes(q)) return true;
  return (j.workTypeTags ?? []).some((t) => t.toLowerCase().includes(q));
}

function matches(j: Job, input: ListJobsInput, now: number): boolean {
  if (input.crew) {
    const crew = (j.constructionCrewForeman ?? "").toLowerCase();
    if (!crew.includes(input.crew.toLowerCase())) return false;
  }
  if (input.status && !statusMatches(j, input.status)) return false;
  if (input.workType && !workTypeMatches(j, input.workType)) return false;
  if (input.city) {
    const c = (j.city ?? "").toLowerCase();
    if (!c.includes(input.city.toLowerCase())) return false;
  }
  if (typeof input.olderThanDays === "number") {
    const updated = (j as Job & { updatedAt?: string | null }).updatedAt;
    if (!updated) return false;
    const t = Date.parse(updated);
    if (Number.isNaN(t)) return false;
    const days = (now - t) / 86_400_000;
    if (days < input.olderThanDays) return false;
  }
  return true;
}

function sortProjection(
  rows: ListedJob[],
  sortBy: ListJobsInput["sortBy"]
): ListedJob[] {
  if (!sortBy) return rows;
  const sorted = [...rows];
  switch (sortBy) {
    case "distance":
      // Rows without a distance fall to the end.
      sorted.sort((a, b) => {
        const da = a.distanceMiles ?? Number.POSITIVE_INFINITY;
        const db = b.distanceMiles ?? Number.POSITIVE_INFINITY;
        return da - db;
      });
      break;
    case "scheduleDate":
      sorted.sort((a, b) => {
        const ta = a.scheduleDate ? Date.parse(a.scheduleDate) : Number.POSITIVE_INFINITY;
        const tb = b.scheduleDate ? Date.parse(b.scheduleDate) : Number.POSITIVE_INFINITY;
        return ta - tb;
      });
      break;
    case "city":
      sorted.sort((a, b) => (a.city ?? "").localeCompare(b.city ?? ""));
      break;
    case "lastUpdated":
      sorted.sort((a, b) => {
        const da = a.lastUpdatedDays ?? Number.POSITIVE_INFINITY;
        const db = b.lastUpdatedDays ?? Number.POSITIVE_INFINITY;
        return da - db;
      });
      break;
  }
  return sorted;
}

async function run(
  input: ListJobsInput,
  ctx: LuminaToolContext
): Promise<LuminaToolResult<ListJobsData>> {
  const now = Date.now();
  const all = await api.listJobs();

  // Supervisor scoping — preserved from v1, was the fix for the "1069 jobs" hallucination.
  const operator = (ctx.username || "").trim().toLowerCase();
  const scopedToSupervisor = !ctx.isManager && operator.length > 0;
  const scoped = scopedToSupervisor
    ? all.jobs.filter(
        (j) => 
          (j.constructionSupervisor ?? "").trim().toLowerCase() === operator ||
          (j.customerProject === "Ziply" && j.geocode && j.geocode.status === "OK" && j.geocode.lat > 47.3073)
      )
    : all.jobs;

  const inTracker = scoped.filter((j) => j.inTracker !== false);
  const filtered = inTracker.filter((j) => matches(j, input, now));

  // Origin handling — must be a full pair to enable distance sort/projection.
  const origin =
    typeof input.originLat === "number" && typeof input.originLng === "number"
      ? { lat: input.originLat, lng: input.originLng }
      : null;

  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, HARD_CAP);
  const truncated = filtered.length > limit;
  const trimmed = truncated ? filtered.slice(0, limit) : filtered;
  const projectedUnsorted = trimmed.map((j) => project(j, now, origin));
  const projected = sortProjection(
    projectedUnsorted,
    // Silently downgrade distance sort to scheduleDate when origin missing —
    // model will see "(distance sort skipped: no origin)" in description.
    input.sortBy === "distance" && !origin ? undefined : input.sortBy
  );

  const filterDescription =
    [
      scopedToSupervisor ? `supervisor="${ctx.username}"` : null,
      input.crew ? `crew~"${input.crew}"` : null,
      input.status ? `status~"${input.status}"` : null,
      input.workType ? `workType~"${input.workType}"` : null,
      input.city ? `city~"${input.city}"` : null,
      input.olderThanDays ? `olderThan ${input.olderThanDays}d` : null,
      input.sortBy === "distance" && !origin
        ? "sort=distance (skipped: no origin)"
        : input.sortBy
        ? `sort=${input.sortBy}`
        : null,
    ]
      .filter(Boolean)
      .join(", ") || "no filter";

  // Honesty hint when 0 results — check if relaxing status would help.
  let zeroMatchHint: string | undefined;
  if (filtered.length === 0 && input.status) {
    const q = normalizeStatusToken(input.status);
    const phaseMatches = inTracker.filter((j) => {
      const phase = normalizeStatusToken(j.secondaryJobStatus ?? "");
      return phase.includes(q) || q.includes(phase);
    });
    if (phaseMatches.length > 0) {
      zeroMatchHint = `No jobs matched on status, but ${phaseMatches.length} match on phase (secondaryJobStatus). Try the same call without the status filter, or describe the phase.`;
    } else {
      const broader = inTracker.length;
      zeroMatchHint = `0 results for "${input.status}". You have ${broader} total jobs in scope — try listing with no status filter to see what phases exist.`;
    }
  }

  return {
    ok: true,
    message: `Found ${filtered.length} job${filtered.length === 1 ? "" : "s"} matching ${filterDescription}.${
      truncated ? ` Showing first ${limit}.` : ""
    }${zeroMatchHint ? ` ${zeroMatchHint}` : ""}`,
    data: {
      total: filtered.length,
      shown: projected.length,
      jobs: projected,
      filterDescription,
      ...(truncated ? { truncatedTo: limit } : {}),
      ...(zeroMatchHint ? { zeroMatchHint } : {}),
    },
  };
}

export const listJobsTool: LuminaTool<ListJobsInput, ListJobsData> = {
  name: "listJobs",
  description:
    "List jobs filtered by crew/status/workType/city/age, optionally sorted by distance from a lat/lng origin, scheduleDate, city, or lastUpdated. Returns lean projection with lat/lng, workTypeTags, notesPreview — most questions answerable without follow-up getJob calls.",
  kind: "read",
  run,
};
