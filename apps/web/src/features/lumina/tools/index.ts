/**
 * Lumina tool registry — central dispatcher.
 *
 * Both the chat surface (text-mode Gemini SDK) and the live-voice surface
 * (geminiLive.ts onToolCall callback) route through dispatchTool(). This
 * is the SINGLE choke point where Lumina interacts with North Sky data.
 *
 * Phase 3 registers all 19 tools: 5 read + 12 map nav + 3 propose-write
 * (write stubs land in Phase 4 — they currently aren't registered).
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";
import { listJobsTool } from "./listJobs.js";
import { getJobTool } from "./getJob.js";
import { listMarkupsTool } from "./listMarkups.js";
import { listPhotosTool } from "./listPhotos.js";
import { searchAddressTool } from "./searchAddress.js";
import { mapNavTools } from "./mapNav.js";

const ALL_TOOLS: LuminaTool<any, any>[] = [
  listJobsTool,
  getJobTool,
  listMarkupsTool,
  listPhotosTool,
  searchAddressTool,
  ...mapNavTools,
];

const REGISTRY: Record<string, LuminaTool<any, any>> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t])
);

/** Look up a tool by the name the model used. */
export function getTool(name: string): LuminaTool | undefined {
  return REGISTRY[name];
}

/**
 * Dispatch a tool call. Returns a stable result shape regardless of failure
 * mode — Gemini Live and the chat surface both expect ok/message/data and
 * will surface ok:false gracefully (refusal-template territory).
 */
export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: LuminaToolContext
): Promise<LuminaToolResult> {
  const tool = REGISTRY[name];
  if (!tool) {
    return { ok: false, message: `Unknown tool: ${name}` };
  }
  try {
    return await tool.run(args, ctx);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[lumina] tool ${name} threw`, err);
    return {
      ok: false,
      message: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Used by the chat surface to enumerate tools for the model. */
export function listRegisteredTools(): LuminaTool[] {
  return Object.values(REGISTRY);
}
