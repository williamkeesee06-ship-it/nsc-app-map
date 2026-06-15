/**
 * Lumina watch-notification proxy — POSTs to Pushover on Lumina's behalf.
 *
 * Why a proxy: we never expose PUSHOVER_APP_TOKEN to the browser. The web
 * tool calls /api/lumina/push, and this route signs the request with the
 * server-side env vars and forwards to api.pushover.net.
 *
 * Pushover API contract: https://pushover.net/api
 *   POST https://api.pushover.net/1/messages.json
 *     token   — app API token (server env)
 *     user    — recipient user key (server env)
 *     message — body text (required, ≤1024 chars)
 *     title   — optional, ≤250 chars
 *     priority — -2|-1|0|1|2 (default 0=normal)
 *     sound   — one of Pushover's predefined sounds, or "none"
 *     url     — optional URL Pushover renders below the message
 *     url_title — optional anchor text for that URL
 */

import { Router, type Request, type Response } from "express";

const router = Router();

const PUSHOVER_ENDPOINT = "https://api.pushover.net/1/messages.json";

// Allowed Pushover priorities: -2 (silent), -1 (quiet), 0 (default), 1 (high), 2 (emergency).
// We don't allow 2 from the chat surface because it requires retry/expire params
// and would page Billy aggressively. If we ever need it, separate explicit tool.
const ALLOWED_PRIORITIES = new Set([-2, -1, 0, 1]);

// Pushover ships a fixed list of named sounds. Letting the model send anything
// else just produces a silent ping, which is a worse UX than rejecting.
const ALLOWED_SOUNDS = new Set([
  "pushover", "bike", "bugle", "cashregister", "classical", "cosmic",
  "falling", "gamelan", "incoming", "intermission", "magic", "mechanical",
  "pianobar", "siren", "spacealarm", "tugboat", "alien", "climb",
  "persistent", "echo", "updown", "vibrate", "none",
]);

interface PushBody {
  title?: string;
  message: string;
  priority?: number;
  sound?: string;
  url?: string;
  urlTitle?: string;
}

router.post("/lumina/push", async (req: Request, res: Response) => {
  const token = process.env.PUSHOVER_APP_TOKEN;
  const user = process.env.PUSHOVER_USER_KEY;
  if (!token || !user) {
    return res.status(500).json({ error: "Pushover credentials not configured." });
  }

  const body = (req.body ?? {}) as PushBody;
  const message = String(body.message ?? "").trim();
  if (!message) return res.status(400).json({ error: "message required" });
  if (message.length > 1024) {
    return res.status(400).json({ error: "message must be ≤1024 chars" });
  }
  const title = body.title ? String(body.title).slice(0, 250) : undefined;
  const priority = typeof body.priority === "number" ? body.priority : 0;
  if (!ALLOWED_PRIORITIES.has(priority)) {
    return res.status(400).json({ error: `priority must be one of -2,-1,0,1` });
  }
  const sound = body.sound ? String(body.sound).toLowerCase() : undefined;
  if (sound && !ALLOWED_SOUNDS.has(sound)) {
    return res
      .status(400)
      .json({ error: `unsupported sound. Allowed: ${[...ALLOWED_SOUNDS].join(", ")}` });
  }

  const form = new URLSearchParams();
  form.set("token", token);
  form.set("user", user);
  form.set("message", message);
  if (title) form.set("title", title);
  form.set("priority", String(priority));
  if (sound) form.set("sound", sound);
  if (body.url) form.set("url", String(body.url).slice(0, 512));
  if (body.urlTitle) form.set("url_title", String(body.urlTitle).slice(0, 100));

  try {
    const r = await fetch(PUSHOVER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const payload = (await r.json().catch(() => ({}))) as { status?: number; errors?: string[]; request?: string };
    if (!r.ok || payload.status !== 1) {
      return res.status(502).json({
        error: "Pushover rejected the message",
        upstream: payload,
      });
    }
    return res.json({ ok: true, requestId: payload.request });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/push] error:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
