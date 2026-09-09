/**
 * Tool: searchEmail
 *
 * Full-text search across Lumina's inbox. Uses Gmail's X-GM-RAW IMAP
 * extension when available (full Gmail search syntax — `from:robbie
 * subject:dig`) and falls back to plain IMAP BODY search.
 *
 * Examples Lumina can pass through:
 *   q="from:robbie@northsky.com"
 *   q="subject:locate"
 *   q="dig ticket"
 *   q="has:attachment newer_than:7d"
 *
 * Read-only — never marks results as seen.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

import { request } from "../../../lib/api.js";

interface SearchEmailInput {
  /** Gmail search syntax or a plain keyword. */
  q: string;
  /** Max results to return (1-50). Default 10. */
  limit?: number;
}

interface SearchEmailStub {
  uid: number;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
}

interface SearchEmailData {
  query: string;
  total: number;
  messages: SearchEmailStub[];
}

async function run(
  input: SearchEmailInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<SearchEmailData>> {
  const q = (input.q ?? "").trim();
  if (!q) return { ok: false, message: "searchEmail requires a non-empty q." };
  const params = new URLSearchParams({ q });
  if (input.limit) params.set("limit", String(input.limit));

  let body: SearchEmailData;
  try {
    body = await request<SearchEmailData>(`/api/lumina/inbox/search?${params.toString()}`);
  } catch (err) {
    return {
      ok: false,
      message: `Inbox search failed. ${(err as Error).message}`,
    };
  }
  return {
    ok: true,
    message:
      body.total === 0
        ? `No messages match "${q}".`
        : `${body.total} matches for "${q}".`,
    data: body,
  };
}

export const searchEmailTool: LuminaTool<SearchEmailInput, SearchEmailData> = {
  name: "searchEmail",
  description:
    "Search Billy's Lumina inbox using Gmail search syntax (from:, subject:, has:attachment, newer_than:7d, etc.) or a plain keyword. Returns matching message stubs. Read-only.",
  kind: "read",
  run,
};
