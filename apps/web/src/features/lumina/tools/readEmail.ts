/**
 * Tool: readEmail
 *
 * Fetch the full parsed body of a single message by UID (which Lumina got
 * from listEmails or searchEmail). Returns plain-text body, recipients,
 * subject, and attachment metadata (filename + size + contentType — not the
 * actual binary; those are large and Lumina rarely needs them inline).
 *
 * Read-only: never marks the message as seen.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

import { request } from "../../../lib/api.js";

interface ReadEmailInput {
  uid: number;
}

interface AttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
}

interface ReadEmailData {
  uid: number;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  unread: boolean;
  text: string;
  html: string;
  attachments: AttachmentMeta[];
}

async function run(
  input: ReadEmailInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<ReadEmailData>> {
  if (typeof input.uid !== "number" || input.uid <= 0) {
    return { ok: false, message: "readEmail requires a numeric uid (from listEmails)." };
  }
  let body: ReadEmailData;
  try {
    body = await request<ReadEmailData>(`/api/lumina/inbox/message/${input.uid}`);
  } catch (err) {
    return {
      ok: false,
      message: `Could not read message ${input.uid}. ${(err as Error).message}`,
    };
  }
  // Strip the HTML payload before handing off to the model — text body is
  // what it should reason over, and we don't want to bloat context.
  const lean: ReadEmailData = { ...body, html: "" };
  return {
    ok: true,
    message: `Read "${body.subject}" from ${body.from} (${body.text.length} chars, ${body.attachments.length} attachments).`,
    data: lean,
  };
}

export const readEmailTool: LuminaTool<ReadEmailInput, ReadEmailData> = {
  name: "readEmail",
  description:
    "Fetch the full plain-text body of a single email by uid (from listEmails/searchEmail). Returns from/to/cc/subject/date/text/attachments metadata. Read-only — does not mark as seen. Use after listEmails when Billy asks 'what does that email say'.",
  kind: "read",
  run,
};
