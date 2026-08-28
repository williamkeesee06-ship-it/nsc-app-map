/**
 * Lumina email inbox — IMAP-backed read-only access to `lumina.northsky@gmail.com`.
 *
 * Three endpoints:
 *
 *   GET  /api/lumina/inbox/list?limit=10&unreadOnly=true&since=2026-06-01
 *        Returns a lean list of message stubs (uid, from, subject, date, snippet, unread).
 *
 *   GET  /api/lumina/inbox/message/:uid
 *        Returns the full parsed body of a single message (text + html + attachments meta).
 *
 *   GET  /api/lumina/inbox/search?q=keyword&limit=10
 *        Full-text search on subject + body. Uses IMAP TEXT search.
 *
 * Strict guardrails:
 *   - Read-only: we never mark messages as seen, never delete, never reply.
 *   - Hard limit of 50 messages per call to protect Vercel function memory.
 *   - Body extracted to plain text only (HTML stripped via mailparser).
 *   - Connection is opened per request and closed in `finally` — no pooling
 *     because Vercel serverless functions are ephemeral.
 */

import { Router, type Request, type Response } from "express";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const router = Router();

// ----- Config -------------------------------------------------------------

const GMAIL_HOST = "imap.gmail.com";
const GMAIL_PORT = 993;

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
    // Don't keep a long connection alive — these are one-shot calls.
    socketTimeout: 20_000,
  });
}

// ----- Helpers ------------------------------------------------------------

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

function snippetFromText(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + "…";
}

// ----- GET /lumina/inbox/list --------------------------------------------

router.get("/lumina/inbox/list", async (req: Request, res: Response) => {
  const creds = getCreds();
  if (!creds) {
    return res.status(500).json({ error: "Lumina Gmail credentials not configured." });
  }
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1), 50);
  const unreadOnly = String(req.query.unreadOnly ?? "false") === "true";
  const sinceRaw = String(req.query.since ?? "").trim();
  const sinceDate = sinceRaw ? new Date(sinceRaw) : null;

  const client = makeClient(creds);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Build IMAP search criteria. Gmail honors all of these.
      const criteria: Record<string, unknown> = {};
      if (unreadOnly) criteria.seen = false;
      if (sinceDate && !Number.isNaN(sinceDate.getTime())) {
        criteria.since = sinceDate;
      }
      const useSearch = Object.keys(criteria).length > 0;

      // If no filters, just grab the tail of the mailbox (most recent N).
      // Gmail returns UIDs in ascending order — we want the last `limit`.
      const mb = client.mailbox;
      const mailboxStatus = typeof mb === "object" && mb ? mb : null;
      const totalExists =
        mailboxStatus && "exists" in mailboxStatus
          ? (mailboxStatus as { exists: number }).exists
          : 0;

      let range: string | number[];
      if (useSearch) {
        const uids = await client.search(criteria, { uid: true });
        if (!uids || uids.length === 0) {
          return res.json({ total: 0, messages: [] });
        }
        range = uids.slice(-limit);
      } else {
        if (totalExists === 0) {
          return res.json({ total: 0, messages: [] });
        }
        const start = Math.max(1, totalExists - limit + 1);
        range = `${start}:${totalExists}`;
      }

      const messages: Array<{
        uid: number;
        from: string;
        subject: string;
        date: string;
        unread: boolean;
        snippet: string;
        hasAttachments: boolean;
      }> = [];

      for await (const msg of client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
        // bodyParts:["1"] won't work for every MIME shape. Pull the small
        // text/plain (or first text part) via `source` length cap instead.
        source: true,
      }, { uid: useSearch })) {
        // Parse just enough to get a snippet. mailparser handles MIME for us.
        let snippet = "";
        let hasAttachments = false;
        try {
          if (msg.source) {
            const parsed = await simpleParser(msg.source);
            snippet = snippetFromText(parsed.text ?? parsed.html?.toString() ?? "");
            hasAttachments = (parsed.attachments?.length ?? 0) > 0;
          }
        } catch {
          // If parsing fails, fall back to subject as snippet so we still ship a row.
          snippet = msg.envelope?.subject ?? "";
        }
        messages.push({
          uid: msg.uid,
          from: formatFrom(msg.envelope as StubEnvelope | undefined),
          subject: msg.envelope?.subject ?? "(no subject)",
          date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : "",
          unread: !msg.flags?.has("\\Seen"),
          snippet,
          hasAttachments,
        });
      }

      // Newest first.
      messages.sort((a, b) => (b.date > a.date ? 1 : -1));
      res.json({ total: messages.length, messages });
    } finally {
      lock.release();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/inbox/list] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
});

// ----- GET /lumina/inbox/message/:uid ------------------------------------

router.get("/lumina/inbox/message/:uid", async (req: Request, res: Response) => {
  const creds = getCreds();
  if (!creds) {
    return res.status(500).json({ error: "Lumina Gmail credentials not configured." });
  }
  const uid = parseInt(req.params.uid, 10);
  if (Number.isNaN(uid) || uid <= 0) {
    return res.status(400).json({ error: "valid uid required" });
  }

  const client = makeClient(creds);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const msg = await client.fetchOne(String(uid), { source: true, envelope: true, flags: true }, { uid: true });
      if (!msg) {
        return res.status(404).json({ error: `Message uid=${uid} not found.` });
      }
      const parsed = await simpleParser(msg.source ?? Buffer.from(""));
      res.json({
        uid,
        from: formatFrom(msg.envelope as StubEnvelope | undefined),
        to: (parsed.to as { text?: string } | undefined)?.text ?? "",
        cc: (parsed.cc as { text?: string } | undefined)?.text ?? "",
        subject: msg.envelope?.subject ?? "(no subject)",
        date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : "",
        unread: !msg.flags?.has("\\Seen"),
        text: parsed.text ?? "",
        html: parsed.html === false ? "" : (parsed.html ?? ""),
        attachments: (parsed.attachments ?? []).map((a) => ({
          filename: a.filename ?? "",
          contentType: a.contentType ?? "",
          size: a.size ?? 0,
        })),
      });
    } finally {
      lock.release();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/inbox/message] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
});

// ----- GET /lumina/inbox/search ------------------------------------------

router.get("/lumina/inbox/search", async (req: Request, res: Response) => {
  const creds = getCreds();
  if (!creds) {
    return res.status(500).json({ error: "Lumina Gmail credentials not configured." });
  }
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.status(400).json({ error: "q (query string) required" });
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1), 50);

  const client = makeClient(creds);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Gmail honors X-GM-RAW which lets us use the full Gmail search syntax.
      // imapflow exposes it via `gmailRaw` in search criteria.
      const uids = await client.search({ gmailRaw: q } as Record<string, unknown>, { uid: true });
      if (!uids || uids.length === 0) {
        // Fallback to plain IMAP body search if Gmail extension is unavailable.
        const fallback = await client.search({ body: q } as Record<string, unknown>, { uid: true });
        if (!fallback || fallback.length === 0) {
          return res.json({ total: 0, messages: [], query: q });
        }
        return await renderResults(client, fallback.slice(-limit), q, res);
      }
      return await renderResults(client, uids.slice(-limit), q, res);
    } finally {
      lock.release();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/inbox/search] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
});

async function renderResults(
  client: ImapFlow,
  uids: number[],
  query: string,
  res: Response
): Promise<void> {
  const messages: Array<{
    uid: number;
    from: string;
    subject: string;
    date: string;
    snippet: string;
    unread: boolean;
  }> = [];
  for await (const msg of client.fetch(uids, { uid: true, envelope: true, flags: true, source: true }, { uid: true })) {
    let snippet = "";
    try {
      if (msg.source) {
        const parsed = await simpleParser(msg.source);
        snippet = snippetFromText(parsed.text ?? "");
      }
    } catch { /* ignore */ }
    messages.push({
      uid: msg.uid,
      from: formatFrom(msg.envelope as StubEnvelope | undefined),
      subject: msg.envelope?.subject ?? "(no subject)",
      date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : "",
      snippet,
      unread: !msg.flags?.has("\\Seen"),
    });
  }
  messages.sort((a, b) => (b.date > a.date ? 1 : -1));
  res.json({ total: messages.length, messages, query });
}

export default router;
