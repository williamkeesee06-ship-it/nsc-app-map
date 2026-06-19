// Lumina inbox-scan cron — scans lumina.northsky@gmail.com for unread messages
// since the last watermark and creates tasks for any that require action.
//
// Schedule explanation (two vercel.json cron entries — JSON doesn't allow comments):
//
//   "0 14-23 * * 1-5"  — hourly 7am–4pm PDT (UTC = PDT+7), Mon–Fri.
//                         14:00 UTC = 7am PDT, 23:00 UTC = 4pm PDT.
//
//   "0 0 * * 2-6"      — the 5pm PDT slot. PDT is UTC-7, so 17:00 PDT = 00:00 UTC
//                         the NEXT calendar day. That next day is Tue–Sat, so
//                         the weekday range is 2-6 (Tuesday through Saturday).
//
// "0 14-24 * * 1-5" would be INVALID because valid hours are 0-23.
//
// Protected by CRON_SECRET (Authorization: Bearer or ?key= like luminaBrief.ts).
// Hard cap: 30 emails per run to protect Vercel function memory.

import { Router, type Request, type Response } from "express";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "../lib/firestore.js";
import { slugifyOwner, type Task } from "./tasks.js";

const router = Router();

// ─── Config ───────────────────────────────────────────────────────────────────

const GMAIL_HOST = "imap.gmail.com";
const GMAIL_PORT = 993;
const OWNER_NAME = "Billy Keesee";
const OWNER_SLUG = slugifyOwner(OWNER_NAME);
const MAX_PER_RUN = 30;
const WATERMARK_DOC = "meta/lumina-inbox-scan";

interface Watermark {
  lastUid: number;
  lastRunAt: number;
}

// ─── IMAP helpers (mirrors luminaInbox.ts pattern) ───────────────────────────

function getCreds(): { user: string; pass: string } | null {
  const user = process.env.LUMINA_GMAIL_USER;
  const pass = process.env.LUMINA_GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return { user, pass };
}

function makeClient(creds: { user: string; pass: string }): ImapFlow {
  return new ImapFlow({
    host: GMAIL_HOST,
    port: GMAIL_PORT,
    secure: true,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
    socketTimeout: 20_000,
  });
}

interface StubEnvelope {
  from?: Array<{ name?: string; address?: string }>;
  subject?: string;
  date?: Date | string;
}

function formatFrom(env: StubEnvelope | undefined): string {
  const from = env?.from?.[0];
  if (!from) return "";
  if (from.name && from.address) return `${from.name} <${from.address}>`;
  return from.address ?? from.name ?? "";
}

// ─── Gemini helper ────────────────────────────────────────────────────────────

/** Ask Gemini whether this email requires an action item for Billy. */
async function classifyEmail(
  apiKey: string,
  subject: string,
  from: string,
  bodyText: string
): Promise<{ actionRequired: boolean; taskText?: string }> {
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
  });

  const prompt = [
    "Read this email and decide if it requires an action item for Billy.",
    "If yes, return JSON: {\"actionRequired\": true, \"taskText\": \"<short imperative sentence under 80 chars>\"}.",
    "If no action needed (newsletter, FYI, automated, marketing), return {\"actionRequired\": false}.",
    "Return ONLY valid JSON, nothing else.",
    "",
    `From: ${from}`,
    `Subject: ${subject}`,
    "",
    "Body (first 1000 chars):",
    bodyText.slice(0, 1000),
  ].join("\n");

  try {
    const result = await model.generateContent(prompt);
    const text = (typeof result.response.text === "function"
      ? result.response.text()
      : "") ?? "";
    // Strip any markdown code fences the model might wrap around the JSON.
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as { actionRequired: boolean; taskText?: string };
    return parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[lumina/inbox-scan] Gemini classify error:", err);
    return { actionRequired: false };
  }
}

// ─── Firestore task creation ──────────────────────────────────────────────────

async function createTask(
  subject: string,
  taskText: string,
  uid: number,
  threadId: string,
  from: string,
  dateIso: string
): Promise<void> {
  const tasksCol = db().collection("tasks");

  // Get next orderIndex for top-level tasks.
  const q = tasksCol
    .where("ownerSlug", "==", OWNER_SLUG)
    .where("parentId", "==", null)
    .orderBy("orderIndex", "desc")
    .limit(1);
  const existing = await q.get();
  const orderIndex = existing.empty
    ? 0
    : ((existing.docs[0].data() as Task).orderIndex ?? 0) + 1;

  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
  const newId = tasksCol.doc().id;
  const now = Date.now();

  const task: Task = {
    id: newId,
    ownerName: OWNER_NAME,
    ownerSlug: OWNER_SLUG,
    text: taskText,
    done: false,
    parentId: null,
    orderIndex,
    source: "lumina-email",
    emailRef: {
      gmailMessageId: String(uid),
      threadId,
      from,
      subject,
      dateIso,
      gmailUrl,
    },
    jobRef: null,
    createdAt: now,
    completedAt: null,
    lastPingedAt: null,
  };

  await tasksCol.doc(newId).set(task);
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get("/lumina/inbox-scan", async (req: Request, res: Response) => {
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

  const creds = getCreds();
  if (!creds) {
    return res.status(500).json({ error: "Lumina Gmail credentials not configured." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not set." });
  }

  // Load watermark.
  let watermark: Watermark = { lastUid: 0, lastRunAt: 0 };
  try {
    const wmSnap = await db().doc(WATERMARK_DOC).get();
    if (wmSnap.exists) {
      watermark = wmSnap.data() as Watermark;
    }
  } catch (wmErr) {
    // eslint-disable-next-line no-console
    console.warn("[lumina/inbox-scan] watermark load error:", wmErr);
  }

  const client = makeClient(creds);
  let processed = 0;
  let tasksCreated = 0;
  let newLastUid = watermark.lastUid;

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Search for UNREAD messages with UID > lastUid.
      const criteria: Record<string, unknown> = { seen: false };
      if (watermark.lastUid > 0) {
        // ImapFlow uid search: fetch UIDs greater than lastUid.
        criteria.uid = `${watermark.lastUid + 1}:*`;
      }
      const uids = await client.search(criteria, { uid: true });
      if (!uids || uids.length === 0) {
        await lock.release();
        // Update watermark timestamp even on empty run.
        await db().doc(WATERMARK_DOC).set({ lastUid: watermark.lastUid, lastRunAt: Date.now() });
        return res.json({ ok: true, processed: 0, tasksCreated: 0, watermark: watermark.lastUid });
      }

      // Newest-first, capped at MAX_PER_RUN.
      const toProcess = uids.slice(-MAX_PER_RUN);

      for await (const msg of client.fetch(
        toProcess,
        { uid: true, envelope: true, source: true, flags: true },
        { uid: true }
      )) {
        // Track max UID seen this run for the watermark.
        if (msg.uid > newLastUid) newLastUid = msg.uid;
        processed++;

        let bodyText = "";
        let parsedThreadId = "";
        let parsedDate = "";

        try {
          if (msg.source) {
            const parsed = await simpleParser(msg.source);
            bodyText = parsed.text ?? "";
            // mailparser exposes messageId but not Gmail's threadId via IMAP.
            // We use the Message-ID header as a proxy; gmailUrl uses the IMAP UID.
            parsedDate = msg.envelope?.date
              ? new Date(msg.envelope.date).toISOString()
              : new Date().toISOString();
            // Gmail threadId is only available via the Gmail API (not IMAP).
            // We fall back to the message UID as the thread anchor which yields
            // a working deep-link: /inbox/<uid> opens that message in Gmail.
            parsedThreadId = String(msg.uid);
          }
        } catch {
          // Parse failure — skip body, still classify based on subject.
        }

        const from = formatFrom(msg.envelope as StubEnvelope | undefined);
        const subject = msg.envelope?.subject ?? "(no subject)";

        // Ask Gemini whether action required.
        const result = await classifyEmail(apiKey, subject, from, bodyText);

        if (result.actionRequired && result.taskText) {
          await createTask(subject, result.taskText, msg.uid, parsedThreadId, from, parsedDate);
          tasksCreated++;
        }
      }
    } finally {
      await lock.release();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/inbox-scan] IMAP error:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  // Persist updated watermark.
  try {
    await db().doc(WATERMARK_DOC).set({ lastUid: newLastUid, lastRunAt: Date.now() });
  } catch (wmErr) {
    // eslint-disable-next-line no-console
    console.warn("[lumina/inbox-scan] watermark save error:", wmErr);
  }

  return res.json({ ok: true, processed, tasksCreated, watermark: newLastUid });
});

export default router;
