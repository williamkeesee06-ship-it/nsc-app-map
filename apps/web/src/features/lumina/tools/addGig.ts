import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";
import { api } from "../../../lib/api.js";

interface AddGigInput {
  jobId: string;
  task: string;
}

interface AddGigData {
  gigId: string;
  jobId: string;
  workOrder: string;
  task: string;
}

async function run(
  input: AddGigInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<AddGigData>> {
  const jobId = (input.jobId ?? "").trim();
  const task = (input.task ?? "").trim();

  if (!jobId || !task) {
    return { ok: false, message: "addGig requires a jobId and a task description." };
  }

  try {
    const res = await api.addGig(jobId, task);
    
    // Dispatch an event to reload gigs/dashboard data
    window.dispatchEvent(new Event("nsc:gigs-reload"));

    return {
      ok: true,
      message: `Gig added: "${res.gig.task}" tied to job ${res.gig.workOrder}.`,
      data: {
        gigId: res.gig.id,
        jobId: res.gig.jobId,
        workOrder: res.gig.workOrder,
        task: res.gig.task,
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: `addGig failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const addGigTool: LuminaTool<AddGigInput, AddGigData> = {
  name: "addGig",
  description:
    "Create a new gig or go-back task for a Ziply project. Use when Billy asks to add or track a gig (e.g. cleanup, fixing irrigation lines we broke, etc.) tied to a project.",
  kind: "read",
  run,
};
