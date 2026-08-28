/**
 * Tool: getMultipleJobs
 *
 * Batch fetch full Job records by jobId list. Lets Lumina answer "summarize
 * the scope of these 5 jobs" in ONE tool call instead of five getJob round-
 * trips. Falls back to ok:true with partial results when some IDs miss.
 *
 * Result is intentionally fuller than listJobs (includes nscProjectNotes in
 * full, workType, dates, geocode) but capped to 25 jobs per call so the
 * model context doesn't blow up.
 */

import type { Job } from "@nsc/types";
import { api } from "../../../lib/api.js";
import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface GetMultipleJobsInput {
  jobIds: string[];
}

interface FullJobRow {
  jobId: string;
  workOrder: string;
  status: string | null;
  phase: string | null;
  crew: string | null;
  supervisor: string | null;
  address: string | null;
  city: string | null;
  zipCode: string | null;
  scheduleDate: string | null;
  actualCompletionDate: string | null;
  trafficControlRequired: boolean | null;
  workType: string | null;
  workTypeTags: string[];
  notes: string | null;
  splicingStatus: string | null;
  permitRequired: string | null;
  lat: number | null;
  lng: number | null;
}

interface GetMultipleJobsData {
  found: FullJobRow[];
  notFound: string[];
}

const HARD_CAP = 25;

function rowFromJob(j: Job): FullJobRow {
  const lat = j.geocode && j.geocode.status === "OK" ? j.geocode.lat : null;
  const lng = j.geocode && j.geocode.status === "OK" ? j.geocode.lng : null;
  return {
    jobId: j.jobId,
    workOrder: j.workOrder,
    status: j.jobStatus && j.jobStatus.trim() !== "" ? j.jobStatus : null,
    phase: j.secondaryJobStatus && j.secondaryJobStatus.trim() !== "" ? j.secondaryJobStatus : null,
    crew: j.constructionCrewForeman ?? null,
    supervisor: j.constructionSupervisor ?? null,
    address: j.address ?? null,
    city: j.city ?? null,
    zipCode: j.zipCode ?? null,
    scheduleDate: j.scheduleDate ?? null,
    actualCompletionDate: j.actualCompletionDate ?? null,
    trafficControlRequired: j.trafficControlRequired ?? null,
    workType: j.workType ?? null,
    workTypeTags: j.workTypeTags ?? [],
    notes: j.nscProjectNotes ?? null,
    splicingStatus: j.splicingStatus ?? null,
    permitRequired: j.permitRequired ?? null,
    lat,
    lng,
  };
}

async function run(
  input: GetMultipleJobsInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<GetMultipleJobsData>> {
  if (!input.jobIds || !Array.isArray(input.jobIds) || input.jobIds.length === 0) {
    return { ok: false, message: "getMultipleJobs requires a non-empty jobIds array." };
  }
  const ids = input.jobIds.slice(0, HARD_CAP);
  // One bulk pull is cheaper than N parallel /jobs/:id requests.
  const all = await api.listJobs();
  const byId = new Map(all.jobs.map((j) => [j.jobId, j]));
  const byWO = new Map(all.jobs.map((j) => [j.workOrder, j]));
  const found: FullJobRow[] = [];
  const notFound: string[] = [];
  for (const id of ids) {
    const hit = byId.get(id) ?? byWO.get(id);
    if (hit) found.push(rowFromJob(hit));
    else notFound.push(id);
  }
  return {
    ok: true,
    message: `Fetched ${found.length} of ${ids.length} jobs.${notFound.length ? ` Missing: ${notFound.join(", ")}.` : ""}`,
    data: { found, notFound },
  };
}

export const getMultipleJobsTool: LuminaTool<GetMultipleJobsInput, GetMultipleJobsData> = {
  name: "getMultipleJobs",
  description:
    "Fetch full records for up to 25 jobs at once. Accepts jobId OR workOrder strings. Use this instead of N separate getJob calls when summarizing multiple jobs.",
  kind: "read",
  run,
};
