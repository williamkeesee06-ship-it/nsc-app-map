/**
 * Lumina tool registry — central dispatcher.
 *
 * Both the chat surface (text-mode Gemini SDK) and the live-voice surface
 * (geminiLive.ts onToolCall callback) route through dispatchTool(). This
 * is the SINGLE choke point where Lumina interacts with North Sky data
 * AND general knowledge.
 *
 * Tool families:
 *   - NSC reads (5)        — listJobs, getJob, getMultipleJobs, listMarkups, listPhotos
 *   - Geo/search reads (2) — searchAddress, getMyLocation, getAsbuiltMarkups
 *   - Map nav (12)         — flyTo* / dropPin / filter / select / route-line
 *   - General knowledge (4) — webSearch, calculate, getWeather, routeOptimize
 *   - Productivity (1)     — scheduleReminder
 *   - Inbox (3)            — listEmails, readEmail, searchEmail
 *   - Watch (1)            — sendWatchPing
 *   - Smartsheet (3)       — listSmartsheetRows, getSmartsheetRow, searchSmartsheetByJob
 *   - Schedule (1)         — getSchedule  (Sprint 2.1, /calendar endpoint)
 *   - Memory (2)           — recallMemory, proposeMemorySave
 *   - Write proposals (4)  — proposeNotesUpdate, proposeStatusChange,
 *                            proposeMarkupLabel, proposeReschedule
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";
import { listJobsTool } from "./listJobs.js";
import { getJobTool } from "./getJob.js";
import { getMultipleJobsTool } from "./getMultipleJobs.js";
import { listMarkupsTool } from "./listMarkups.js";
import { listPhotosTool } from "./listPhotos.js";
import { searchAddressTool } from "./searchAddress.js";
import { getMyLocationTool } from "./getMyLocation.js";
import { getAsbuiltMarkupsTool } from "./getAsbuiltMarkups.js";
import { mapNavTools } from "./mapNav.js";
import { webSearchTool } from "./webSearch.js";
import { calculateTool } from "./calculate.js";
import { getWeatherTool } from "./getWeather.js";
import { routeOptimizeTool } from "./routeOptimize.js";
import { scheduleReminderTool } from "./scheduleReminder.js";
import { listEmailsTool } from "./listEmails.js";
import { readEmailTool } from "./readEmail.js";
import { searchEmailTool } from "./searchEmail.js";
import { sendWatchPingTool } from "./sendWatchPing.js";
import { smartsheetTools } from "./smartsheetTools.js";
import { getScheduleTool } from "./getSchedule.js";
import { writeTools } from "./writeTools.js";
import { memoryTools } from "./memoryTools.js";
import { addTaskTool } from "./addTask.js";
import { completeTaskTool } from "./completeTask.js";
import { listOpenTasksTool } from "./listOpenTasks.js";
import { digTicketTools } from "./digTicketTools.js";
import { searchCodebaseTool, readSourceFileTool } from "./codeTools.js";
import { queryFirestoreTool } from "./dataTools.js";

const ALL_TOOLS: LuminaTool<any, any>[] = [
  // NSC reads
  listJobsTool,
  getJobTool,
  getMultipleJobsTool,
  listMarkupsTool,
  listPhotosTool,
  // Geo / address
  searchAddressTool,
  getMyLocationTool,
  getAsbuiltMarkupsTool,
  // Map navigation (12 tools)
  ...mapNavTools,
  // General intelligence
  webSearchTool,
  calculateTool,
  getWeatherTool,
  routeOptimizeTool,
  // Productivity
  scheduleReminderTool,
  // Inbox
  listEmailsTool,
  readEmailTool,
  searchEmailTool,
  // Watch
  sendWatchPingTool,
  // Smartsheet (Billy-scoped, read-only)
  ...smartsheetTools,
  // Schedule read (Sprint 2.1)
  getScheduleTool,
  // Memory + writes (Sprint 1.4 un-stubs notes/status; 2.1 adds reschedule)
  ...writeTools,
  ...memoryTools,
  // Tasks (TASKS tab — Lumina can add/complete/list)
  addTaskTool,
  completeTaskTool,
  listOpenTasksTool,
  // 811 Dig Ticket Manager
  ...digTicketTools,
  // God Mode - Codebase Access
  searchCodebaseTool,
  readSourceFileTool,
  // God Mode - Data Access
  queryFirestoreTool,
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
