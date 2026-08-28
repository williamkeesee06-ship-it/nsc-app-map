/**
 * Tool: getJob — full record for one job from Firestore.
 *
 * Lumina is allowed to quote every field below verbatim. She must NOT make up
 * fields that aren't returned (e.g. don't invent splicing dates if null).
 *
 * We return a slightly denormalized projection so the model doesn't have to
 * reason about which secondary field to use — `effectiveStatus` collapses
 * jobStatus / secondaryJobStatus to a single string, but both raw fields are
 * still exposed so an audit log can show what was actually on file.
 */

import type { Job } from "@nsc/types";
import { api } from "../../../lib/api.js";
import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface GetJobInput {
  jobId: string;
}

interface GetJobData {
  jobId: string;
  workOrder: string;
  effectiveStatus: string | null;
  jobStatus: string | null;
  secondaryJobStatus: string | null;
  crew: string | null;
  supervisor: string | null;
  customerProject: string | null;
  workType: string | null;
  workTypeTags: string[];
  address: string | null;
  city: string | null;
  zip: string | null;
  scheduleDate: string | null;
  actualStartDate: string | null;
  actualCompletionDate: string | null;
  notes: string | null;
  trafficControlRequired: boolean | null;
  permitRequired: string | null;
  splicingStatus: string | null;
  inTracker: boolean;
  lat: number | null;
  lng: number | null;
  hasGeocode: boolean;
}

function project(j: Job): GetJobData {
  return {
    jobId: j.jobId,
    workOrder: j.workOrder,
    effectiveStatus: j.jobStatus ?? j.secondaryJobStatus ?? null,
    jobStatus: j.jobStatus,
    secondaryJobStatus: j.secondaryJobStatus,
    crew: j.constructionCrewForeman,
    supervisor: j.constructionSupervisor,
    customerProject: j.customerProject,
    workType: j.workType,
    workTypeTags: j.workTypeTags ?? [],
    address: j.address,
    city: j.city,
    zip: j.zipCode,
    scheduleDate: j.scheduleDate,
    actualStartDate: j.actualStartDate,
    actualCompletionDate: j.actualCompletionDate,
    notes: j.nscProjectNotes,
    trafficControlRequired: j.trafficControlRequired,
    permitRequired: j.permitRequired,
    splicingStatus: j.splicingStatus,
    inTracker: j.inTracker,
    lat: j.geocode?.lat ?? null,
    lng: j.geocode?.lng ?? null,
    hasGeocode: j.geocode?.status === "OK",
  };
}

async function resolveJob(jobIdOrWO: string): Promise<Job | null> {
  // Try direct fetch first; if 404, fall back to a search by work order.
  try {
    const r = await api.getJob(jobIdOrWO);
    return r.job;
  } catch {
    try {
      const r = await api.searchJobs(jobIdOrWO);
      return r.jobs[0] ?? null;
    } catch {
      return null;
    }
  }
}

async function run(
  input: GetJobInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<GetJobData>> {
  if (!input.jobId) {
    return { ok: false, message: "getJob requires jobId." };
  }
  const job = await resolveJob(input.jobId);
  if (!job) {
    return { ok: false, message: `No job found for "${input.jobId}".` };
  }
  return {
    ok: true,
    message: `Job ${job.workOrder} — ${job.jobStatus ?? "no status"}.`,
    data: project(job),
  };
}

export const getJobTool: LuminaTool<GetJobInput, GetJobData> = {
  name: "getJob",
  description: "Fetch the full record for one job from Firestore.",
  kind: "read",
  run,
};
