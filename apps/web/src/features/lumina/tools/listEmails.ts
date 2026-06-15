/**
 * Tool: listEmails
 *
 * Reads the most recent messages from Lumina's dedicated Gmail inbox
 * (`lumina.northsky@gmail.com`). Read-only — never marks messages as seen,
 * never deletes. Backed by /api/lumina/inbox/list which uses IMAP via
 * imapflow.
 *
 * Use this whenever Billy asks anything inbox-shaped:
 *   "what's in my email?"
 *   "any new emails from Robbie?"        → use searchEmail instead
 *   "anything urgent unread?"             → unreadOnly:true
 *   "emails since Monday?"                → since:"2026-06-08"
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface ListEmailsInput {
  /** Max messages to return (1-50). Default 10. */
  limit?: number;
  /** Only return unread messages. Default false. */
  unreadOnly?: boolean;
  /** ISO date — only return messages newer than this. */
  since?: string;
}

interface EmailStub {
  uid: number;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
  snippet: string;
  hasAttachments: boolean;
}

interface ListEmailsData {
  total: number;
  messages: EmailStub[];
}

async function run(
  input: ListEmailsInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<ListEmailsData>> {
  const params = new URLSearchParams();
  if (input.limit) params.set("limit", String(input.limit));
  if (input.unreadOnly) params.set("unreadOnly", "true");
  if (input.since) params.set("since", input.since);

  const res = await fetch(`/api/lumina/inbox/list?${params.toString()}`);
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? "";
    } catch { /* ignore */ }
    return {
      ok: false,
      message: `Inbox unavailable (${res.status}).${detail ? " " + detail : ""}`,
    };
  }
  const body = (await res.json()) as ListEmailsData;
  const unreadCount = body.messages.filter((m) => m.unread).length;
  return {
    ok: true,
    message:
      body.total === 0
        ? "Inbox is empty for that filter."
        : `${body.total} messages (${unreadCount} unread).`,
    data: body,
  };
}

export const listEmailsTool: LuminaTool<ListEmailsInput, ListEmailsData> = {
  name: "listEmails",
  description:
    "List recent messages from Billy's Lumina-managed inbox (lumina.northsky@gmail.com). Returns uid, from, subject, date, unread flag, snippet, and attachment flag. Read-only — never marks as seen. Use limit/unreadOnly/since to scope.",
  kind: "read",
  run,
};
