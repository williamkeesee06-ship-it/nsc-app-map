import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";
import { api } from "../../../lib/api.js";

interface ListOpenGigsInput {
  jobId?: string;
}

interface GigSummary {
  id: string;
  jobId: string;
  workOrder: string;
  task: string;
  createdAt: number;
}

interface ListOpenGigsData {
  gigs: GigSummary[];
}

async function run(
  input: ListOpenGigsInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<ListOpenGigsData>> {
  const jobId = (input.jobId ?? "").trim() || undefined;

  try {
    const res = await api.listGigs(jobId);
    // Filter open gigs (status === "open")
    const openGigs = res.gigs
      .filter((g) => g.status === "open")
      .map((g) => ({
        id: g.id,
        jobId: g.jobId,
        workOrder: g.workOrder,
        task: g.task,
        createdAt: g.createdAt,
      }));

    return {
      ok: true,
      message: `${openGigs.length} open gig${openGigs.length === 1 ? "" : "s"} found.`,
      data: { gigs: openGigs },
    };
  } catch (err) {
    return {
      ok: false,
      message: `listOpenGigs failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const listOpenGigsTool: LuminaTool<ListOpenGigsInput, ListOpenGigsData> = {
  name: "listOpenGigs",
  description:
    "List Ziply open gigs and go-backs. Optionally filter by a specific project's job ID or work order.",
  kind: "read",
  run,
};
