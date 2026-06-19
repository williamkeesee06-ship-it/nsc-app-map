// Lumina stale-task ping cron — checks for open tasks sitting > 24 h with no
// ping and notifies Billy via Pushover.
//
// Schedule (vercel.json): "0 * * * *" — hourly.
// Protected by CRON_SECRET (same as luminaBrief.ts / luminaInboxScan.ts).
//
// Each pinged task gets lastPingedAt = now so it won't fire again for 24 h.

import { Router, type Request, type Response } from "express";
import { db } from "../lib/firestore.js";
import type { Task } from "./tasks.js";

const router = Router();

const PUSHOVER_ENDPOINT = "https://api.pushover.net/1/messages.json";
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

// ─── HTML → plain text (simple, no external deps) ─────────────────────────

/** Strip HTML tags and collapse whitespace into a plain-text summary. */
function htmlToText(html: string, maxLen = 120): string {
  const noTags = html.replace(/<[^>]+>/g, " ");
  const decoded = noTags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.slice(0, maxLen - 1) + "…";
}

// ─── Pushover helper (inlined — same pattern as luminaBrief.ts) ──────────────

async function pushover(args: {
  token: string;
  user: string;
  title: string;
  message: string;
  sound?: string;
}): Promise<void> {
  const form = new URLSearchParams();
  form.set("token", args.token);
  form.set("user", args.user);
  form.set("title", args.title);
  form.set("message", args.message);
  form.set("priority", "0");
  form.set("sound", args.sound ?? "magic");

  const r = await fetch(PUSHOVER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!r.ok) {
    const payload = await r.json().catch(() => ({})) as { errors?: string[] };
    throw new Error(`Pushover error: ${JSON.stringify(payload)}`);
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get("/lumina/stale-tasks", async (req: Request, res: Response) => {
  // Auth: same pattern as luminaBrief.ts.
  const secret = process.env.CRON_SECRET ?? "";
  if (secret) {
    const auth = req.header("authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const key = String(req.query.key ?? "");
    if (bearer !== secret && key !== secret) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const token = process.env.PUSHOVER_APP_TOKEN;
  const user = process.env.PUSHOVER_USER_KEY;
  if (!token || !user) {
    return res.status(500).json({ error: "Pushover credentials not configured." });
  }

  const now = Date.now();
  const cutoff = now - TWENTY_FOUR_HOURS;

  try {
    // Query all open tasks created more than 24 h ago.
    const snap = await db()
      .collection("tasks")
      .where("done", "==", false)
      .where("createdAt", "<", cutoff)
      .get();

    const stale = snap.docs
      .map((d) => ({ ...(d.data() as Task), id: d.id }))
      .filter((t) => t.lastPingedAt === null || t.lastPingedAt < cutoff);

    let pinged = 0;
    for (const task of stale) {
      const plainText = htmlToText(task.text);
      try {
        await pushover({
          token,
          user,
          title: "📌 Task sitting 24h",
          message: plainText,
          sound: "magic",
        });
        await db().collection("tasks").doc(task.id).update({ lastPingedAt: now });
        pinged++;
      } catch (pingErr) {
        // Log and continue — one failure shouldn't abort the whole run.
        // eslint-disable-next-line no-console
        console.warn(`[lumina/stale-tasks] ping failed for task ${task.id}:`, pingErr);
      }
    }

    return res.json({ ok: true, pinged });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/stale-tasks] error:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
