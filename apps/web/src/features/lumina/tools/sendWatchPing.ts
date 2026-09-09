/**
 * Tool: sendWatchPing
 *
 * Sends a push notification to Billy's Samsung watch (and phone) via
 * Pushover. The /api/lumina/push backend signs the request with the
 * server-side PUSHOVER_APP_TOKEN + PUSHOVER_USER_KEY so creds never
 * leave the server.
 *
 * Use cases:
 *   - Lumina sees urgent inbox mail              → priority 1, sound "siren"
 *   - Lumina finishes a long-running operation   → priority 0, sound "magic"
 *   - Lumina reminds Billy about a scheduled job → priority 0, sound default
 *   - Lumina sends the morning brief              → priority 0, sound "intermission"
 *
 * Priority ladder (Pushover convention):
 *   -2 = silent (notification only, no sound/vibrate)
 *   -1 = quiet  (sound suppressed by quiet hours)
 *    0 = normal (default)
 *    1 = high   (bypass quiet hours, sound + vibrate even on silent)
 *
 * Allowed sounds (Pushover fixed list):
 *   pushover, bike, bugle, cashregister, classical, cosmic, falling,
 *   gamelan, incoming, intermission, magic, mechanical, pianobar, siren,
 *   spacealarm, tugboat, alien, climb, persistent, echo, updown, vibrate,
 *   none
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

import { request } from "../../../lib/api.js";

interface SendWatchPingInput {
  message: string;
  title?: string;
  priority?: number; // -2|-1|0|1, default 0
  sound?: string;
  /** Optional URL Pushover shows beneath the message (e.g. job link). */
  url?: string;
  urlTitle?: string;
}

interface SendWatchPingData {
  requestId: string;
}

async function run(
  input: SendWatchPingInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<SendWatchPingData>> {
  const message = (input.message ?? "").trim();
  if (!message) {
    return { ok: false, message: "sendWatchPing requires a non-empty message." };
  }
  if (message.length > 1024) {
    return { ok: false, message: "Message too long (max 1024 chars)." };
  }
  const payload: Record<string, unknown> = { message };
  if (input.title) payload.title = input.title;
  if (typeof input.priority === "number") payload.priority = input.priority;
  if (input.sound) payload.sound = input.sound;
  if (input.url) payload.url = input.url;
  if (input.urlTitle) payload.urlTitle = input.urlTitle;

  let body: { ok: boolean; requestId: string };
  try {
    body = await request<{ ok: boolean; requestId: string }>("/api/lumina/push", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      ok: false,
      message: `Pushover ping failed. ${(err as Error).message}`,
    };
  }
  return {
    ok: true,
    message: `Watch pinged: "${input.title ?? "Lumina"}" — ${message.slice(0, 80)}${message.length > 80 ? "…" : ""}`,
    data: { requestId: body.requestId },
  };
}

export const sendWatchPingTool: LuminaTool<SendWatchPingInput, SendWatchPingData> = {
  name: "sendWatchPing",
  description:
    "Send a push notification to Billy's Samsung watch (mirrored from his phone via Pushover). Use proactively for urgent inbox alerts, finished long-running ops, scheduled reminders, or daily briefs. Priority: -2 silent, -1 quiet, 0 normal, 1 high (bypasses quiet hours). Common sounds: magic (default chime), siren (urgent), intermission (calm brief), cashregister (good news), spacealarm (alert).",
  kind: "read",
  run,
};
