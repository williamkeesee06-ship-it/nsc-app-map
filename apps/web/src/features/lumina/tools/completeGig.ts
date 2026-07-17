import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";
import { api } from "../../../lib/api.js";

interface CompleteGigInput {
  gigId: string;
}

interface CompleteGigData {
  gigId: string;
}

async function run(
  input: CompleteGigInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<CompleteGigData>> {
  const gigId = (input.gigId ?? "").trim();

  if (!gigId) {
    return { ok: false, message: "completeGig requires a gigId." };
  }

  try {
    await api.completeGig(gigId);
    
    // Dispatch an event to reload gigs/dashboard data
    window.dispatchEvent(new Event("nsc:gigs-reload"));

    return {
      ok: true,
      message: `Gig marked as completed.`,
      data: { gigId },
    };
  } catch (err) {
    return {
      ok: false,
      message: `completeGig failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const completeGigTool: LuminaTool<CompleteGigInput, CompleteGigData> = {
  name: "completeGig",
  description:
    "Mark a Ziply gig or go-back task as completed. Use when Billy says a gig is completed, done, or fixed.",
  kind: "read",
  run,
};
