import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";
import { api } from "../../../lib/api.js";

interface RemoveGigInput {
  gigId: string;
}

interface RemoveGigData {
  gigId: string;
}

async function run(
  input: RemoveGigInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<RemoveGigData>> {
  const gigId = (input.gigId ?? "").trim();

  if (!gigId) {
    return { ok: false, message: "removeGig requires a gigId." };
  }

  try {
    await api.deleteGig(gigId);
    
    // Dispatch an event to reload gigs/dashboard data
    window.dispatchEvent(new Event("nsc:gigs-reload"));

    return {
      ok: true,
      message: `Gig removed.`,
      data: { gigId },
    };
  } catch (err) {
    return {
      ok: false,
      message: `removeGig failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const removeGigTool: LuminaTool<RemoveGigInput, RemoveGigData> = {
  name: "removeGig",
  description:
    "Remove or delete a Ziply gig or go-back task. Use when Billy asks to remove or delete a gig.",
  kind: "read",
  run,
};
