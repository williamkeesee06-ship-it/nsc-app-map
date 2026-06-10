/**
 * Tool: listJobs
 *
 * Hits the existing /api/jobs endpoint and filters in-memory by crew,
 * status, age, and city. Returns a LEAN projection — just enough for
 * the model to reason and answer. Full job records are fetched via
 * getJob() (Phase 3) to keep prompt context small.
 *
 * Lumina is allowed to quote the returned values verbatim. She is NOT
 * allowed to invent any field that isn't in the projection.
 */

import type { Job } from "@nsc/types";
import { api } from "../../../lib/api.js";
import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface ListJobsInput {
  crew?: string;
  status?: string;
  olderThanDays?: number;
  city?: string;
}

/** Lean projection that goes back to the model. */
interface ListedJob {
  jobId: string;
  workOrder: string;
  status: string | null;
  crew: string | null;
  city: string | null;
  address: string | null;
  scheduleDate: string | null;
  lastUpdatedDays: number | null;
}

interface ListJobsData {
  total: number;
  shown: number;
  jobs: ListedJob[];
  /** If the result set was trimmed, this is the hard cap that was hit. */
  truncatedTo?: number;
}

const HARD_CAP = 50; // never return more than this to the model

function project(j: Job, now: number): ListedJob {
  const updated = (j as Job & { updatedAt?: string | null }).updatedAt;
  let lastUpdatedDays: number | null = null;
  if (updated) {
    const t = Date.parse(updated);
    if (!Number.isNaN(t)) lastUpdatedDays = Math.floor((now - t) / (24 * 60 * 60 * 1000));
  }
  return {
    jobId: j.jobId,
    workOrder: j.workOrder,
    status: j.jobStatus ?? j.secondaryJobStatus ?? null,
    crew: j.constructionCrewForeman ?? null,
    city: j.city ?? null,
    address: j.address ?? null,
    scheduleDate: j.scheduleDate ?? null,
    lastUpdatedDays,
  };
}

function matches(j: Job, input: ListJobsInput, now: number): boolean {
  if (input.crew) {
    const crew = (j.constructionCrewForeman ?? "").toLowerCase();
    if (!crew.includes(input.crew.toLowerCase())) return false;
  }
  if (input.status) {
    const s = (j.jobStatus ?? j.secondaryJobStatus ?? "").toLowerCase();
    if (!s.includes(input.status.toLowerCase())) return false;
  }
  if (input.city) {
    const c = (j.city ?? "").toLowerCase();
    if (!c.includes(input.city.toLowerCase())) return false;
  }
  if (typeof input.olderThanDays === "number") {
    const updated = (j as Job & { updatedAt?: string | null }).updatedAt;
    if (!updated) return false;
    const t = Date.parse(updated);
    if (Number.isNaN(t)) return false;
    const days = (now - t) / (24 * 60 * 60 * 1000);
    if (days < input.olderThanDays) return false;
  }
  return true;
}

async function run(
  input: ListJobsInput,
  ctx: LuminaToolContext
): Promise<LuminaToolResult<ListJobsData>> {
  const now = Date.now();
  const all = await api.listJobs();

  // Phase 9.7 parity: scope to the operator's supervisor unless they're
  // a manager. Without this, Lumina reports the GLOBAL job count (1000+),
  // not the supervisor's actual count — a hallucination Billy caught
  // ("You have 1069 jobs" when the screen showed 216).
  const operator = (ctx.username || "").trim().toLowerCase();
  const scopedToSupervisor = !ctx.isManager && operator.length > 0;
  const scoped = scopedToSupervisor
    ? all.jobs.filter(
        (j) => (j.constructionSupervisor ?? "").trim().toLowerCase() === operator
      )
    : all.jobs;

  const filtered = scoped.filter((j: Job) => j.inTracker !== false && matches(j, input, now));
  const truncated = filtered.length > HARD_CAP;
  const trimmed = truncated ? filtered.slice(0, HARD_CAP) : filtered;
  const projected = trimmed.map((j: Job) => project(j, now));

  const filterDesc =
    [
      // Lead with the supervisor scope so the model sees exactly whose
      // jobs it's counting and can phrase its reply correctly ("YOU have
      // X jobs" vs "there are X jobs in the system").
      scopedToSupervisor ? `supervisor="${ctx.username}"` : null,
      input.crew ? `crew~"${input.crew}"` : null,
      input.status ? `status~"${input.status}"` : null,
      input.city ? `city~"${input.city}"` : null,
      input.olderThanDays ? `olderThan ${input.olderThanDays}d` : null,
    ]
      .filter(Boolean)
      .join(", ") || "no filter";

  return {
    ok: true,
    message: `Found ${filtered.length} job${filtered.length === 1 ? "" : "s"} matching ${filterDesc}.${
      truncated ? ` Showing first ${HARD_CAP}.` : ""
    }`,
    data: {
      total: filtered.length,
      shown: projected.length,
      jobs: projected,
      ...(truncated ? { truncatedTo: HARD_CAP } : {}),
    },
  };
}

export const listJobsTool: LuminaTool<ListJobsInput, ListJobsData> = {
  name: "listJobs",
  description: "List jobs filtered by crew, status, age in days, or city.",
  kind: "read",
  run,
};
